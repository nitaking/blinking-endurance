"use client";

import {useEffect, useRef, useState} from "react";
import {Button} from "@/components/ui/button";
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import {Alert, AlertDescription, AlertTitle} from "@/components/ui/alert";
import Webcam from "react-webcam";
import * as tf from "@tensorflow/tfjs";
import * as faceLandmarksDetection from "@tensorflow-models/face-landmarks-detection";

export default function BlinkingEndurance() {
  const [isRunning, setIsRunning] = useState(false);
  const [time, setTime] = useState(0);
  const [bestTime, setBestTime] = useState(0);
  const [isBlinking, setIsBlinking] = useState(false);
  const [model, setModel] = useState<faceLandmarksDetection.FaceLandmarksDetector | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isModelLoading, setIsModelLoading] = useState(true);
  const [debugInfo, setDebugInfo] = useState<string>("");

  const webcamRef = useRef<Webcam>(null);
  const requestRef = useRef<number>();

  const blinkThreshold = 0.2; // EARの閾値。通常0.2～0.25
  const blinkFrames = useRef(0); // 連続して瞬きを検出したフレーム数
  const requiredBlinkFrames = 1; // 瞬きと判定するために必要な連続フレーム数

  // MediaPipeFaceMeshのキーポイントインデックスに基づいて設定
  const LEFT_EYE_KEYPOINTS = [33, 160, 158, 133, 153, 144, 362, 385, 387, 263, 373, 380];
  const RIGHT_EYE_KEYPOINTS = [362, 385, 387, 263, 373, 380, 33, 160, 158, 133, 153, 144];

  const timeRef = useRef<number>(0); // 最新の time を保持する ref

  useEffect(() => {
    timeRef.current = time;
  }, [time]);

  useEffect(() => {
    const loadModel = async () => {
      try {
        setIsModelLoading(true);
        await tf.ready();
        const loadedModel = await faceLandmarksDetection.createDetector(
            faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh,
            {
              runtime: "tfjs",
              refineLandmarks: true,
            }
        );
        setModel(loadedModel);
        setIsModelLoading(false);
      } catch (err) {
        console.error("モデルの読み込みに失敗しました:", err);
        setError("モデルの読み込みに失敗しました。ページを再読み込みしてください。");
        setIsModelLoading(false);
      }
    };
    loadModel();

    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (isRunning) {
      interval = setInterval(() => {
        setTime((prevTime) => prevTime + 10);
      }, 10);
    }

    return () => clearInterval(interval);
  }, [isRunning]);

  // 瞬き判定を常に実行するためにuseEffectを追加
  useEffect(() => {
    if (model) {
      requestRef.current = requestAnimationFrame(detectBlink);
    }

    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);


  const detectBlink = async () => {
    if (
        model &&
        webcamRef.current &&
        webcamRef.current.video &&
        webcamRef.current.video.readyState === 4
    ) {
      try {
        const video = webcamRef.current.video;
        const predictions = await model.estimateFaces(video);

        if (predictions.length > 0) {
          const keypoints = predictions[0].keypoints;

          // 左右の目のキーポイントを取得
          const leftEyePoints = LEFT_EYE_KEYPOINTS.map(index => keypoints[index]);
          const rightEyePoints = RIGHT_EYE_KEYPOINTS.map(index => keypoints[index]);

          // 目のキーポイントがすべて存在するか確認
          const leftEyeExists = leftEyePoints.every(point => point !== undefined && point !== null);
          const rightEyeExists = rightEyePoints.every(point => point !== undefined && point !== null);

          if (!leftEyeExists || !rightEyeExists) {
            // 目のキーポイントが検出されない場合、瞬きと判定
            blinkFrames.current += 1;
            setIsBlinking(true);
            setDebugInfo("目のキーポイントが検出されませんでした。瞬きと判定します。");

            if (blinkFrames.current >= requiredBlinkFrames) {
              console.info("瞬き検出: チャレンジを終了します。");
              handleStop();
            }
          } else {
            // EARを計算
            const leftEAR = calculateEAR(leftEyePoints);
            const rightEAR = calculateEAR(rightEyePoints);
            const averageEAR = (leftEAR + rightEAR) / 2;

            setDebugInfo(
                `EAR: ${averageEAR.toFixed(3)}, 閾値: ${blinkThreshold}, フレーム: ${blinkFrames.current}/${requiredBlinkFrames}`,
            );

            if (averageEAR < blinkThreshold) {
              blinkFrames.current += 1;
              setIsBlinking(true);
              console.info(`瞬き検出: EAR=${averageEAR.toFixed(3)}, フレーム数=${blinkFrames.current}`);

              if (blinkFrames.current >= requiredBlinkFrames) {
                console.info("瞬き検出: チャレンジを終了します。");
                handleStop();
              }
            } else {
              blinkFrames.current = 0;
              setIsBlinking(false);
            }
          }
        } else {
          // 顔が検出されていない場合の処理
          blinkFrames.current += 1;
          setIsBlinking(true);
          setDebugInfo("顔が検出されませんでした。瞬きと判定します。");

          if (blinkFrames.current >= requiredBlinkFrames) {
            console.info("顔が検出されず、瞬きと判定: チャレンジを終了します。");
            handleStop();
          }
        }

        if (model) {
          requestRef.current = requestAnimationFrame(detectBlink);
        }
      } catch (err) {
        console.error("瞬き検出中にエラーが発生しました:", err);
        setError("瞬き検出中にエラーが発生しました。ページを再読み込みしてください。");
        handleStop();
      }
    } else {
      // ビデオが準備できていない場合は次のフレームを待つ
      requestRef.current = requestAnimationFrame(detectBlink);
    }
  };

  const calculateEAR = (eyePoints: faceLandmarksDetection.Keypoint[]) => {
    // EARの計算:
    // EAR = (|p2 - p6| + |p3 - p5|) / (2 * |p1 - p4|)
    // p1: 左端, p4: 右端
    if (eyePoints.length !== 12) {
      return 0;
    }

    const A = distance(eyePoints[1], eyePoints[5]);
    const B = distance(eyePoints[2], eyePoints[4]);
    const C = distance(eyePoints[0], eyePoints[3]);

    return (A + B) / (2.0 * C);
  };

  const distance = (p1: faceLandmarksDetection.Keypoint, p2: faceLandmarksDetection.Keypoint) => {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
  };

  const handleStart = () => {
    if (!webcamRef.current || !webcamRef.current.video) {
      setError("Webカメラにアクセスできません。カメラの許可を確認してください。");
      return;
    }
    setIsRunning(true);
    setTime(0);
    setError(null);
    blinkFrames.current = 0;
    setIsBlinking(false);
    setDebugInfo("チャレンジを開始しました。目を閉じると終了します。");
  };

  const handleStop = () => {
    setIsRunning(false);
    if (requestRef.current) {
      cancelAnimationFrame(requestRef.current);
    }

    const time = timeRef.current
    console.debug({ time: timeRef.current, bestTime });
    setBestTime(prevBestTime => Math.max(prevBestTime, time)); // 関数型更新を使用
    setDebugInfo("チャレンジが終了しました。");
  };

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const milliseconds = ms % 1000;
    return `${seconds}.${milliseconds.toString().padStart(3, "0")}`;
  };


  return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-2xl font-bold text-center">瞬き耐久チャレンジ</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4">
              <Webcam
                  ref={webcamRef}
                  audio={false}
                  width={400}
                  height={300}
                  className="rounded-lg"
                  onUserMediaError={() => setError("Webカメラへのアクセスが拒否されました。")}
                  videoConstraints={{
                    facingMode: "user",
                  }}
              />
            </div>
            <div className="text-center mb-4">
              <p className="text-4xl font-bold mb-2" aria-live="polite">
                {formatTime(time)}
              </p>
              <p className="text-sm text-gray-500">最高記録: {formatTime(bestTime)}</p>
              <p className="text-sm text-blue-500 mt-2">{isRunning && debugInfo}</p>
              <p className="text-sm text-green-500 mt-1">
                瞬き状態: {isBlinking ? "目を閉じています" : "目を開いています"}
              </p>
              <p className="text-sm text-purple-500 mt-1">連続フレーム数: {blinkFrames.current}</p>
            </div>
            <div className="flex justify-center">
              {!isRunning ? (
                  <Button
                      onClick={handleStart}
                      disabled={!model || isModelLoading}
                      aria-label="チャレンジ開始"
                  >
                    {isModelLoading ? "モデル読み込み中..." : "スタート"}
                  </Button>
              ) : (
                  <Button onClick={handleStop} variant="destructive" aria-label="チャレンジ終了">
                    強制終了
                  </Button>
              )}
            </div>
            {error && (
                <Alert variant="destructive" className="mt-4">
                  <AlertTitle>エラー</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}
          </CardContent>
        </Card>
      </div>
  );
}
