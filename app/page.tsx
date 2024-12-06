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
  const eyeOpenessHistory = useRef<number[]>([]);
  const historyLength = 10; // 履歴の長さ

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

  const detectBlink = async () => {
    if (model && webcamRef.current && webcamRef.current.video) {
      try {
        const predictions = await model.estimateFaces(webcamRef.current.video);

        if (predictions.length > 0) {
          const keypoints = predictions[0].keypoints;
          const leftEye = keypoints.filter(
            (point) => point.name && point.name.toLowerCase().includes("left_eye"),
          );
          const rightEye = keypoints.filter(
            (point) => point.name && point.name.toLowerCase().includes("right_eye"),
          );

          if (leftEye.length > 1 && rightEye.length > 1) {
            const leftEyeOpenness = calculateEyeOpenness(leftEye);
            const rightEyeOpenness = calculateEyeOpenness(rightEye);

            const averageOpenness = (leftEyeOpenness + rightEyeOpenness) / 2;
            eyeOpenessHistory.current.push(averageOpenness);
            if (eyeOpenessHistory.current.length > historyLength) {
              eyeOpenessHistory.current.shift();
            }

            const averageHistoryOpenness =
              eyeOpenessHistory.current.reduce((a, b) => a + b, 0) /
              eyeOpenessHistory.current.length;
            const normalizedOpenness = averageOpenness / averageHistoryOpenness;

            setDebugInfo(
              `目の開き具合: ${normalizedOpenness.toFixed(3)}, 閾値: ${blinkThreshold}, フレーム: ${blinkFrames.current}/${requiredBlinkFrames}`,
            );

            if (normalizedOpenness < blinkThreshold) {
              blinkFrames.current += 1;
              console.debug("判定");
              if (blinkFrames.current >= requiredBlinkFrames) {
                setIsBlinking(true);
                handleStop();
                return;
              }
            } else {
              blinkFrames.current = 0;
              setIsBlinking(false);
            }
          }
        }

        console.debug('before requestAnimationFrame');
        if (isRunning) {
          console.debug('set requestAnimationFrame');
          requestRef.current = requestAnimationFrame(detectBlink);
        }
      } catch (err) {
        console.error("瞬き検出中にエラーが発生しました:", err);
        setError("瞬き検出中にエラーが発生しました。ページを再読み込みしてください。");
        handleStop();
      }
    }
  };

  const calculateEyeOpenness = (eyePoints: faceLandmarksDetection.Keypoint[]) => {
    const topPoint = eyePoints.find((point) => point.name?.includes("top"));
    const bottomPoint = eyePoints.find((point) => point.name?.includes("bottom"));
    if (topPoint && bottomPoint) {
      return Math.abs(topPoint.y - bottomPoint.y);
    }
    return 0;
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
    eyeOpenessHistory.current = [];
    requestRef.current = requestAnimationFrame(detectBlink);
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
            />
          </div>
          <div className="text-center mb-4">
            <p className="text-4xl font-bold mb-2" aria-live="polite">
              {formatTime(time)}
            </p>
            <p className="text-sm text-gray-500">最高記録: {formatTime(bestTime)}</p>
            <p className="text-sm text-blue-500 mt-2">{debugInfo}</p>
            <p className="text-sm text-green-500 mt-1">
              瞬き状態: {isBlinking ? "瞬いています" : "目を開いています"}
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
