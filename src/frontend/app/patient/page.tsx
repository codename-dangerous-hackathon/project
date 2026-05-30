"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";

export default function PatientPage() {
  const [status, setStatus] = useState<"idle" | "listening" | "speaking" | "camera">("idle");
  const [subtitle, setSubtitle] = useState("I am here to help you.");
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Mock Handle Talk Button
  const handleTalk = async () => {
    if (status === "camera") stopCamera();
    setStatus("listening");
    setSubtitle("Listening...");
    
    // In production, we'd record MediaRecorder audio here and send to /transcribe.
    // For now we'll simulate a flow:
    setTimeout(async () => {
      setStatus("speaking");
      setSubtitle("Let me think about that...");
      
      try {
        // Here we'd normally pass the transcribed text
        const response = await fetch("/api/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_input: "When is my daughter coming?" })
        });
        
        const data = await response.json();
        setSubtitle(data.reply || "I am always here for you.");
        
        // Fetch audio for the reply
        const audioRes = await fetch("/api/synthesize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_input: data.reply || "Hello" })
        });
        
        const blob = await audioRes.blob();
        const url = URL.createObjectURL(blob);
        
        if (!audioRef.current) {
          audioRef.current = new Audio(url);
        } else {
          audioRef.current.src = url;
        }
        
        audioRef.current.play();
        audioRef.current.onended = () => {
          setStatus("idle");
          setSubtitle("Press the big button to talk to me.");
        };
      } catch (e) {
        console.error("Backend offline", e);
        setStatus("idle");
        setSubtitle("My connection is resting right now.");
      }
    }, 2000); // simulate listening delay
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setStatus("camera");
      setSubtitle("Point the camera at them.");
    } catch (err) {
      console.error("Camera access denied or unavailable", err);
      setSubtitle("Camera is not available.");
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setStatus("idle");
  };

  const handleIdentify = async () => {
    if (status !== "camera") {
      startCamera();
      return;
    }

    // Capture Frame to Canvas
    if (!videoRef.current) return;
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    const base64Image = canvas.toDataURL("image/jpeg").split(',')[1];
    
    setSubtitle("Looking...");
    
    try {
      const res = await fetch("/api/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_base64: base64Image })
      });
      const data = await res.json();
      
      const reply = data.match 
        ? `This is ${data.name}, your ${data.relationship}.` 
        : "I don't recognize this person yet.";
        
      setSubtitle(reply);
      stopCamera();
      
      // Auto-play TTS for the face identification
      const audioRes = await fetch("/api/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_input: reply })
      });
      const blob = await audioRes.blob();
      const url = URL.createObjectURL(blob);
      if (!audioRef.current) audioRef.current = new Audio(url);
      else audioRef.current.src = url;
      audioRef.current.play();

    } catch (e) {
      setSubtitle("I couldn't look right now.");
      stopCamera();
    }
  };

  return (
    <main className="flex flex-col items-center justify-center w-full min-h-[100dvh] bg-black text-white p-4 font-sans select-none relative">
      
      {/* Subtle Home Button in Top Left */}
      <Link href="/" className="absolute top-6 left-6 p-3 text-zinc-600 hover:text-zinc-300 transition-colors bg-zinc-900/50 hover:bg-zinc-800 rounded-full" title="Back to Home">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
      </Link>

      {/* Dynamic Header */}
      <h1 className="text-4xl md:text-5xl font-medium text-center text-zinc-300 mb-8 max-w-2xl px-4 min-h-[5rem]">
        {subtitle}
      </h1>

      {/* Camera View Overlay */}
      {status === "camera" && (
        <div className="relative w-full max-w-sm rounded-[3rem] overflow-hidden shadow-2xl border-4 border-zinc-700 bg-zinc-900 mb-8 aspect-[3/4]">
          <video 
            ref={videoRef} 
            autoPlay 
            playsInline 
            className="w-full h-full object-cover"
          />
          {/* Subtle targeting box */}
          <div className="absolute inset-0 pointer-events-none border-2 border-dashed border-white/30 m-8 rounded-xl" />
        </div>
      )}
      
      {/* Massive Glowing Talk Button */}
      {status !== "camera" && (
        <button 
          onClick={handleTalk}
          disabled={status !== "idle"}
          className={`relative rounded-full transition-all duration-300 flex items-center justify-center shadow-2xl
            ${status === "idle" ? "bg-amber-600 hover:bg-amber-500 hover:scale-105 active:scale-95 h-64 w-64 md:h-80 md:w-80" : ""}
            ${status === "listening" ? "bg-red-600 animate-pulse h-72 w-72 md:h-96 md:w-96" : ""}
            ${status === "speaking" ? "bg-emerald-600 animate-pulse h-64 w-64 md:h-80 md:w-80 shadow-[0_0_80px_rgba(5,150,105,0.6)]" : ""}
          `}
        >
          <span className="text-4xl md:text-5xl font-bold tracking-wide">
            {status === "idle" && "TALK"}
            {status === "listening" && "LISTENING"}
            {status === "speaking" && "SPEAKING"}
          </span>
        </button>
      )}

      {/* Secondary Actions Row */}
      <div className="flex gap-6 mt-16 w-full max-w-2xl justify-center">
        <button 
          onClick={handleIdentify}
          className="flex-1 bg-zinc-800 hover:bg-zinc-700 rounded-3xl py-8 text-2xl md:text-3xl font-medium transition-transform active:scale-95 border border-zinc-700"
        >
          {status === "camera" ? "👁️ Identify Face" : "📷 Who is this?"}
        </button>
        <button className="flex-1 bg-zinc-800 hover:bg-zinc-700 rounded-3xl py-8 text-2xl md:text-3xl font-medium transition-transform active:scale-95 border border-zinc-700">
          📖 Memories
        </button>
      </div>

    </main>
  );
}
