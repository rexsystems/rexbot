import type { ClientSettings } from "@rex/shared";
import { endVoiceSession, saveVoiceTurn, startVoiceSession, voiceTool } from "./api";

export interface LiveConnection { stop: () => Promise<void>; mute: (muted: boolean) => void }
interface Callbacks {
  state: (state: string) => void;
  transcript: (role: "user" | "assistant", text: string) => void;
  error: (message: string) => void;
}

export function encodePcm(samples: Float32Array, rate: number): string {
  const length = Math.floor(samples.length * 16000 / rate);
  const bytes = new Uint8Array(length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < length; i++) {
    const value = Math.max(-1, Math.min(1, samples[Math.min(samples.length - 1, Math.floor(i * rate / 16000))]!));
    view.setInt16(i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function startLiveVoice(conversationId: string, settings: ClientSettings, signal: AbortSignal, callbacks: Callbacks): Promise<LiveConnection> {
  if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) throw new Error("Live voice requires microphone access in a secure browser context (localhost or HTTPS).");
  let audio: AudioContext;
  try { audio = new AudioContext({ sampleRate: 16000, latencyHint: "interactive" }); }
  catch { audio = new AudioContext(); }
  let stream: MediaStream | undefined;
  let socket: WebSocket | undefined;
  let capture: AudioWorkletNode | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let sessionId: string | undefined;
  let closed = false;
  let ready = false;
  let muted = false;
  let nextPlayTime = 0;
  let userText = "";
  let assistantText = "";
  let saves = Promise.resolve();
  let stopping: Promise<void> | undefined;
  const cancelledTools = new Set<string>();
  const playing = new Set<AudioBufferSourceNode>();
  function stopPlayback() { for (const node of playing) { try { node.stop(); } catch { /* A completed source is already stopped. */ } } playing.clear(); nextPlayTime = 0; }
  function saveTurn() {
    if (!sessionId || (!userText.trim() && !assistantText.trim())) return;
    const id = sessionId;
    const turn = { id: crypto.randomUUID(), user: userText, assistant: assistantText };
    userText = assistantText = "";
    saves = saves.then(async () => { await saveVoiceTurn(id, turn); }).catch((error) => callbacks.error(`Could not save voice transcript: ${error instanceof Error ? error.message : String(error)}`));
  }
  function stop(): Promise<void> {
    if (stopping) return stopping;
    closed = true;
    ready = false;
    stream?.getTracks().forEach((track) => track.stop());
    capture?.disconnect();
    source?.disconnect();
    stopPlayback();
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    stopping = (async () => {
      await audio.close().catch(() => undefined);
      saveTurn();
      await saves;
      if (sessionId) await endVoiceSession(sessionId).catch((error) => callbacks.error(error instanceof Error ? error.message : String(error)));
      callbacks.state("Ended");
    })();
    return stopping;
  }
  const check = () => { if (signal.aborted) throw new DOMException("Call cancelled", "AbortError"); };
  try {
    await audio.resume();
    callbacks.state("Requesting microphone");
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    check();
    callbacks.state("Connecting");
    const config = await startVoiceSession(conversationId, settings, signal);
    sessionId = config.id;
    check();
    await audio.audioWorklet.addModule(`${import.meta.env.BASE_URL}pcm-capture.js`);
    check();
    capture = new AudioWorkletNode(audio, "pcm-capture");
    source = audio.createMediaStreamSource(stream);
    source.connect(capture);
    const silent = audio.createGain();
    silent.gain.value = 0;
    capture.connect(silent).connect(audio.destination);
    capture.port.onmessage = (event: MessageEvent<Float32Array>) => {
      if (ready && !muted && socket?.readyState === WebSocket.OPEN && socket.bufferedAmount < 128_000) socket.send(JSON.stringify({ realtimeInput: { audio: { data: encodePcm(event.data, audio.sampleRate), mimeType: "audio/pcm;rate=16000" } } }));
    };
    socket = new WebSocket(config.url);
    const connection = socket;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Google Live did not finish connecting. Try again.")), 20_000);
      const abort = () => { clearTimeout(timeout); reject(new DOMException("Call cancelled", "AbortError")); void stop(); };
      signal.addEventListener("abort", abort, { once: true });
      connection.onopen = () => connection.send(JSON.stringify({ setup: config.setup }));
      connection.onerror = () => { clearTimeout(timeout); reject(new Error("Could not connect to Google Live. Check your connection and model access.")); if (ready) { callbacks.error("Google Live connection failed."); void stop(); } };
      connection.onclose = () => { clearTimeout(timeout); signal.removeEventListener("abort", abort); if (!closed) { reject(new Error("Google Live closed the connection.")); void stop(); } };
      connection.onmessage = async (event) => {
        try {
          const data = JSON.parse(typeof event.data === "string" ? event.data : await event.data.text());
          if (closed) return;
          if (data.error) throw new Error(data.error.message || "Google Live returned an error.");
          for (const id of data.toolCallCancellation?.ids ?? []) cancelledTools.add(id);
          if (data.setupComplete) {
            clearTimeout(timeout);
            if (config.history.length) connection.send(JSON.stringify({ clientContent: { turns: config.history, turnComplete: true } }));
            ready = true;
            callbacks.state("Listening");
            resolve();
          }
          const content = data.serverContent;
          if (content?.interrupted) { stopPlayback(); callbacks.state("Listening"); }
          if (content?.inputTranscription?.text) { userText += content.inputTranscription.text; callbacks.transcript("user", content.inputTranscription.text); }
          if (content?.outputTranscription?.text) { assistantText += content.outputTranscription.text; callbacks.transcript("assistant", content.outputTranscription.text); }
          for (const part of content?.modelTurn?.parts ?? []) {
            if (!part.inlineData?.mimeType?.startsWith("audio/pcm")) continue;
            const binary = atob(part.inlineData.data);
            const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
            const pcm = new DataView(bytes.buffer);
            const rate = Number(part.inlineData.mimeType.match(/rate=(\d+)/)?.[1] ?? 24000);
            const buffer = audio.createBuffer(1, Math.floor(bytes.length / 2), rate);
            const samples = buffer.getChannelData(0);
            for (let i = 0; i < samples.length; i++) samples[i] = pcm.getInt16(i * 2, true) / 32768;
            const node = audio.createBufferSource();
            node.buffer = buffer;
            node.connect(audio.destination);
            playing.add(node);
            node.onended = () => { playing.delete(node); if (!playing.size && !closed) callbacks.state(muted ? "Muted" : "Listening"); };
            nextPlayTime = Math.max(audio.currentTime + .02, nextPlayTime);
            node.start(nextPlayTime);
            nextPlayTime += buffer.duration;
            callbacks.state("Speaking");
          }
          if (data.toolCall?.functionCalls) {
            callbacks.state("Using tools");
            for (const call of data.toolCall.functionCalls) {
              if (cancelledTools.has(call.id) || closed) continue;
              let response: unknown;
              try { response = await voiceTool(config.id, call.name, call.args ?? {}); }
              catch (error) { response = { error: error instanceof Error ? error.message : String(error) }; }
              if (!cancelledTools.has(call.id) && !closed && connection.readyState === WebSocket.OPEN) connection.send(JSON.stringify({ toolResponse: { functionResponses: [{ id: call.id, name: call.name, response }] } }));
            }
          }
          if (content?.turnComplete) { saveTurn(); if (!playing.size) callbacks.state(muted ? "Muted" : "Listening"); }
          if (data.goAway) { callbacks.error("Google Live is ending this session. Start another call to continue."); void stop(); }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          clearTimeout(timeout);
          callbacks.error(message);
          reject(new Error(message));
          void stop();
        }
      };
    });
    check();
    return { stop, mute(value) { muted = value; stream?.getAudioTracks().forEach((track) => { track.enabled = !value; }); if (value && connection.readyState === WebSocket.OPEN) connection.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } })); callbacks.state(value ? "Muted" : "Listening"); } };
  } catch (error) { await stop(); throw error; }
}
