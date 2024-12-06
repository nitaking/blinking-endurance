"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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

  const blinkThreshold = 0.15; // 瞬きを検出する閾値
  const blinkFrames = useRef(0); // 連続して瞬きを検出したフレーム数
  const requiredBlinkFrames = 2; // 瞬きと判定するために必要な連続フレーム数
  const eyeOpennessHistory = useRef<number[]>([]);
  const historyLength = 10; // 履歴の長さ

  // 左目と右目の上部および下部のキーポイントインデックス
  // MediaPipeFaceMeshのキーポイントインデックスに基づいて設定
  const LEFT_EYE_TOP_INDEX = 159;
  const LEFT_EYE_BOTTOM_INDEX = 145;
  const RIGHT_EYE_TOP_INDEX = 386;
  const RIGHT_EYE_BOTTOM_INDEX = 374;

  useEffect(() => {
    console.debug('loadModel');
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
    if (model && webcamRef.current && webcamRef.current.video && webcamRef.current.video.readyState === 4) {
      try {
        const video = webcamRef.current.video;
        const predictions = await model.estimateFaces(video);

        if (predictions.length > 0) {
          const keypoints = predictions[0].keypoints;

          const leftEyeTop = keypoints[LEFT_EYE_TOP_INDEX];
          const leftEyeBottom = keypoints[LEFT_EYE_BOTTOM_INDEX];
          const rightEyeTop = keypoints[RIGHT_EYE_TOP_INDEX];
          const rightEyeBottom = keypoints[RIGHT_EYE_BOTTOM_INDEX];

          const leftEyeOpenness = calculateEyeOpenness(leftEyeTop, leftEyeBottom);
          const rightEyeOpenness = calculateEyeOpenness(rightEyeTop, rightEyeBottom);

          const averageOpenness = (leftEyeOpenness + rightEyeOpenness) / 2;
          eyeOpennessHistory.current.push(averageOpenness);
          if (eyeOpennessHistory.current.length > historyLength) {
            eyeOpennessHistory.current.shift();
          }

          const averageHistoryOpenness =
              eyeOpennessHistory.current.reduce((a, b) => a + b, 0) /
              eyeOpennessHistory.current.length;
          const normalizedOpenness = averageOpenness / averageHistoryOpenness;

          setDebugInfo(
              `目の開き具合: ${normalizedOpenness.toFixed(3)}, 閾値: ${blinkThreshold}, フレーム: ${blinkFrames.current}/${requiredBlinkFrames}`,
          );

          if (normalizedOpenness < blinkThreshold) {
            blinkFrames.current += 1;
            console.debug("判定");
            if (blinkFrames.current >= requiredBlinkFrames) {
              setIsBlinking(true);
              if (isRunning) {
                handleStop();
              }
              // 瞬き検出後も継続して判定を行う場合はここで必要に応じて処理を追加
            }
          } else {
            blinkFrames.current = 0;
            setIsBlinking(false);
          }
        }else {
          // 顔が検出されていない場合も瞬きと判定（必要に応じて変更可能）
          blinkFrames.current += 1;
          setIsBlinking(true);
          setDebugInfo("顔が検出されませんでした。瞬きと判定します。");

        }

        console.debug('before requestAnimationFrame');
        if (model) {
          console.debug('set requestAnimationFrame');
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

  const calculateEyeOpenness = (topPoint: faceLandmarksDetection.Keypoint, bottomPoint: faceLandmarksDetection.Keypoint) => {
    return Math.abs(topPoint.y - bottomPoint.y);
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
    eyeOpennessHistory.current = [];
    // スタート時に瞬き判定をリセット
  };

  const handleStop = () => {
    setIsRunning(false);
    if (requestRef.current) {
      cancelAnimationFrame(requestRef.current);
    }
    if (time > bestTime) {
      setBestTime(time);
    }
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
              <p className="text-sm text-blue-500 mt-2">{debugInfo}</p>
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
