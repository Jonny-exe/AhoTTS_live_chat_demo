"use client"

import { useState, useEffect, useRef } from "react"

// Define message type for better type safety
type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
}

export default function VoiceChatbot() {
  const [isRecording, setIsRecording] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [dotSize, setDotSize] = useState(80)
  const [volume, setVolume] = useState(0)
  const [conversationHistory, setConversationHistory] = useState<ChatMessage[]>([
    {
      role: "system",
      content: "You are a helpful voice assistant. Keep responses concise and conversational.",
    }
  ])

  // Refs for audio processing
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const animationFrameRef = useRef<number | null>(null)
  const silenceStartRef = useRef<number | null>(null)
  const speechSynthRef = useRef<SpeechSynthesis | null>(null)

  // Initialize speech synthesis
  useEffect(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      speechSynthRef.current = window.speechSynthesis
    }

    return () => {
      if (speechSynthRef.current) {
        speechSynthRef.current.cancel()
      }
    }
  }, [])

  // Update dot size based on volume with smoother animation
  useEffect(() => {
    if (!isRecording) return

    // Base size + volume amplification with smoother transition
    // Larger base size for a more minimal, bigger dot
    const targetSize = 80 + volume * 120

    // Animate the dot size change
    const animateDotSize = () => {
      setDotSize((current) => {
        const diff = targetSize - current
        // Ease towards target size
        const newSize = current + diff * 0.2
        return Math.min(Math.max(newSize, 80), 200) // Clamp between 80-200px
      })

      animationFrameRef.current = requestAnimationFrame(animateDotSize)
    }

    animationFrameRef.current = requestAnimationFrame(animateDotSize)

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [volume, isRecording])

  // Detect silence for processing
  useEffect(() => {
    if (!isRecording || isProcessing) return

    if (volume < 0.05) {
      // Start counting silence
      if (silenceStartRef.current === null) {
        silenceStartRef.current = Date.now()
      } else if (Date.now() - silenceStartRef.current > 1500) {
        // 1.5 seconds of silence - process audio
        processAudio()
      }
    } else {
      // Reset silence counter if volume increases
      silenceStartRef.current = null
    }
  }, [volume, isRecording, isProcessing])

  // Clean up on unmount
  useEffect(() => {
    return () => {
      cleanupAudio()
      if (speechSynthRef.current) {
        speechSynthRef.current.cancel()
      }
    }
  }, [])

  // Toggle recording
  const toggleRecording = async () => {
    if (isRecording || isProcessing) {
      stopRecording()
    } else {
      await startRecording()
    }
  }

  // Initialize audio recording
  const startRecording = async () => {
    try {
      // Reset
      audioChunksRef.current = []
      silenceStartRef.current = null

      // Get user media
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      streamRef.current = stream

      // Create audio context
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
      audioContextRef.current = audioContext

      // Create analyser for volume detection
      const analyser = audioContext.createAnalyser()
      analyserRef.current = analyser
      analyser.fftSize = 1024
      analyser.smoothingTimeConstant = 0.8

      // Create source from stream
      const source = audioContext.createMediaStreamSource(stream)
      source.connect(analyser)

      // Create script processor for volume monitoring
      const processor = audioContext.createScriptProcessor(2048, 1, 1)
      processorRef.current = processor

      // Connect processor
      analyser.connect(processor)
      processor.connect(audioContext.destination)

      // Set up volume monitoring
      const bufferLength = analyser.frequencyBinCount
      const dataArray = new Uint8Array(bufferLength)

      processor.onaudioprocess = () => {
        analyser.getByteFrequencyData(dataArray)
        const currentVolume = calculateVolume(dataArray)
        setVolume(currentVolume)
      }

      // Set up media recorder
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm",
      })
      mediaRecorderRef.current = mediaRecorder

      // Collect audio data
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      // Start recording
      mediaRecorder.start(100)

      setIsRecording(true)
    } catch (error) {
      console.error("Error initializing audio:", error)
    }
  }

  // Process audio after silence is detected
  const processAudio = async () => {
    if (audioChunksRef.current.length === 0) return

    setIsProcessing(true)
    setIsRecording(false)
    stopRecording()

    try {
      // Create audio blob from chunks
      console.log(audioChunksRef.current)
      // const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm;codecs=opus" })
      const audioBlob = new Blob(audioChunksRef.current, { type: "audio/wav" })

      // const url1 = URL.createObjectURL(audioBlob);
      // // setAudioUrl(url);

      // // Optionally auto-play
      // const audio1 = new Audio(url1);

      // audio1.play();
      // // Create form data for API request
      // const formData = new FormData()
      // formData.append("file", audioBlob, "audio.webm")
      // formData.append("model", "whisper-1")

      // // Send to OpenAI API for transcription
      // console.log(process.env.NEXT_PUBLIC_OPENAI_API_KEY, formData)

      // const transcriptionResponse = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      //   method: "POST",
      //   headers: {
      //     Authorization: `Bearer ${process.env.NEXT_PUBLIC_OPENAI_API_KEY}`,
      //   },
      //   body: formData,
      // })

      // if (!transcriptionResponse.ok) {
      //   console.log(transcriptionResponse)
      //   throw new Error("Failed to transcribe audio")
      // }

      // const transcriptionData = await transcriptionResponse.json()

      // if (!transcriptionData.text) {
      //   // No transcription
      //   setIsProcessing(false)
      //   return
      // }

      // // Send transcription to OpenAI for response

      async function blobToBase64(blob: Blob) {
        const arrayBuffer = await blob.arrayBuffer();  // Convert Blob to ArrayBuffer
        const uint8Array = new Uint8Array(arrayBuffer); // Create a Uint8Array from ArrayBuffer

        let binaryString = '';
        uint8Array.forEach(byte => {
          binaryString += String.fromCharCode(byte); // Convert each byte to a character
        });

        return btoa(binaryString); // Convert the binary string to Base64
      }

      // Example usage:

      let base64audio = "";
      await (async () => {
        const base64String = await blobToBase64(audioBlob);
        console.log(base64String);  // Outputs: SGVsbG8sIFdvcmxkIQ==
        base64audio = base64String
      })();

      const responseTranscribed = await fetch("https://aholab.ehu.eus/HiTZketan/api/predict", {
        method: "POST",
        body: JSON.stringify({
          data: ["microfono", {"name": "audio", "data": "data:audio/wav;base64," + base64audio}, null, "eu"],
          fn_index: 0
        }),
        headers: {
          "Content-Type": "application/json"
        }

      })

      if (!responseTranscribed.ok) {
        console.log("There has been error with transcribe")
      }

      const transcribedJson = await responseTranscribed.json()
      const userMessage = transcribedJson.data[0]

      // Send the transcribed text and conversation history to our backend
      // The backend will handle the ChatGPT API call and return both text and audio
      const backendResponse = await fetch("http://localhost:9000/content_receiver", {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
        },
        body: JSON.stringify({
          messages: [
            ...conversationHistory,
            {
              role: "user",
              content: userMessage
            }
          ]
        })
      })

      if (!backendResponse.ok) {
        throw new Error(`Failed to get response from backend: ${backendResponse.status}`)
      }

      // Parse the response which contains both text and base64-encoded audio
      const responseData = await backendResponse.json()
      const aiText = responseData.text
      const audioBase64 = responseData.audio

      console.log("Received response from backend")

      // Update conversation history with the new messages
      setConversationHistory(prevHistory => [
        ...prevHistory,
        { role: "user", content: userMessage },
        { role: "assistant", content: aiText }
      ])

      // Convert the base64 audio to a blob
      const binaryString = atob(audioBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: 'audio/wav' });
      console.log("Created audio blob from base64 data")

      // Create a URL from the Blob
      const url = URL.createObjectURL(blob);
      // setAudioUrl(url);

      // Optionally auto-play
      const audio = new Audio(url);
      await audio.play();
      audio.onended = function(){
        console.log("After play")
        startRecording()
      }

    } catch (error) {
      console.error("Error processing audio:", error)
    } finally {
      setIsProcessing(false)
    }
  }

  // Stop recording
  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop()
    }

    cleanupAudio()
    setIsRecording(false)
  }

  // Calculate volume from audio data
  const calculateVolume = (dataArray: Uint8Array) => {
    let sum = 0
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i]
    }
    const average = sum / dataArray.length
    return average / 255 // Normalize to 0-1 range
  }

  // Clean up audio resources
  const cleanupAudio = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop()
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
    }

    if (processorRef.current) {
      processorRef.current.disconnect()
    }

    if (analyserRef.current) {
      analyserRef.current.disconnect()
    }

    if (audioContextRef.current) {
      audioContextRef.current.close()
    }
  }

  return (
    <div className="flex flex-col items-center justify-center w-full max-w-md mx-auto py-8">
      {/* Logo */}
      <div className="mb-8 w-full max-w-xs">
        <img src="/logo.svg" alt="ahoMyTTS Logo" className="w-full" />
      </div>

      {/* Microphone icon - simple SVG */}
      <div className="mb-6">
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="opacity-50"
        >
          <path
            d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"
            stroke="#333333"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M19 10v2a7 7 0 0 1-14 0v-2"
            stroke="#333333"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <line
            x1="12"
            x2="12"
            y1="19"
            y2="22"
            stroke="#333333"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      {/* Minimal animated dot */}
      <div
        className="relative flex items-center justify-center cursor-pointer"
        onClick={!isProcessing ? toggleRecording : undefined}
      >
        {/* Simple ripple effect - only show when recording */}
        {isRecording && (
          <div
            className="absolute rounded-full animate-pulse"
            style={{
              width: `${dotSize * 1.4}px`,
              height: `${dotSize * 1.4}px`,
              animationDuration: '1.5s',
              backgroundColor: 'rgba(231, 61, 68, 0.2)' // Red from ahoMyTTS with transparency
            }}
          />
        )}

        {/* Main dot - larger and more minimal */}
        <div
          className={`rounded-full transition-all ${
            isProcessing ? "animate-pulse" :
            isRecording ? "animate-pulse" :
            ""
          }`}
          style={{
            width: `${dotSize}px`,
            height: `${dotSize}px`,
            transition: "width 0.15s, height 0.15s, background-color 0.3s",
            animationDuration: isRecording ? '2s' : '0s',
            backgroundColor: isProcessing ? '#666666' : isRecording ? '#E73D44' : '#333333'
            // Red (#E73D44) when recording, dark gray (#333333) when idle, medium gray (#666666) when processing
          }}
        />
      </div>

      {/* Minimal status indicator */}
      <div
        className="mt-3 text-sm font-medium"
        style={{
          color: isProcessing ? '#666666' : isRecording ? '#E73D44' : '#333333'
        }}
      >
        {isProcessing ? "Processing..." : isRecording ? "Listening..." : "Tap to speak"}
      </div>
    </div>
  )
}

