/** One WebSocket to the room, reconnecting quietly if the line drops. */
export class Link {
  #url; #hello; #ws = null; #handlers = new Map(); #retry = 0;

  constructor(url, hello) {
    this.#url = url;
    this.#hello = hello;
    this.#open();
  }

  on(type, fn) { this.#handlers.set(type, fn); return this; }

  get open() { return this.#ws?.readyState === WebSocket.OPEN; }

  send(msg) {
    if (!this.open) return false;
    this.#ws.send(JSON.stringify(msg));
    return true;
  }

  #emit(type, msg) { this.#handlers.get(type)?.(msg); }

  #open() {
    const ws = this.#ws = new WebSocket(this.#url);
    ws.onopen = () => { this.#retry = 0; ws.send(JSON.stringify(this.#hello())); this.#emit('open'); };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m && typeof m.t === 'string') this.#emit(m.t, m);
    };
    ws.onclose = () => {
      this.#emit('close');
      setTimeout(() => this.#open(), Math.min(8000, 400 * 2 ** this.#retry++));
    };
  }
}

/** Shared clock: server time, estimated from the fastest ping round-trip we've seen. */
export class Clock {
  offset = 0;
  #best = Infinity;
  now() { return Date.now() + this.offset; }
  sample(sentAt, serverAt) {
    const rtt = Date.now() - sentAt;
    if (rtt > this.#best * 1.5 && this.#best !== Infinity) return;
    this.#best = Math.min(this.#best, rtt);
    this.offset = serverAt + rtt / 2 - Date.now();
  }
}

/**
 * Peer-to-peer voice over WebRTC, signalled through the room socket.
 * Uses the "perfect negotiation" pattern (MDN), so either side may switch the mic on first.
 */
export class Voice {
  #send; #onStream;
  pc = null;
  stream = null;
  polite = false;
  peer = false;
  #makingOffer = false;
  #ignoreOffer = false;

  constructor({ send, onStream }) { this.#send = send; this.#onStream = onStream; }

  async enable() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    if (this.peer) this.#attach();
    return this.stream;
  }

  disable() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.pc?.getSenders().forEach((s) => this.pc.removeTrack(s));
  }

  joined(polite) {
    this.peer = true;
    this.polite = polite;
    if (this.stream) this.#attach();
  }

  left() {
    this.peer = false;
    this.pc?.close();
    this.pc = null;
  }

  #ensure() {
    if (this.pc) return this.pc;
    const pc = this.pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    pc.onicecandidate = ({ candidate }) => candidate && this.#send({ candidate: candidate.toJSON() });
    pc.ontrack = ({ streams }) => streams[0] && this.#onStream(streams[0]);
    pc.onnegotiationneeded = async () => {
      try {
        this.#makingOffer = true;
        await pc.setLocalDescription();
        this.#send({ description: pc.localDescription.toJSON() });
      } catch (err) { console.warn('voice offer failed', err); } finally { this.#makingOffer = false; }
    };
    return pc;
  }

  #attach() {
    const pc = this.#ensure();
    const sending = new Set(pc.getSenders().map((s) => s.track));
    this.stream.getTracks().forEach((t) => !sending.has(t) && pc.addTrack(t, this.stream));
  }

  async signal({ description, candidate }) {
    const pc = this.#ensure();
    try {
      if (description && typeof description.type === 'string') {
        const collision = description.type === 'offer' && (this.#makingOffer || pc.signalingState !== 'stable');
        this.#ignoreOffer = !this.polite && collision;
        if (this.#ignoreOffer) return;
        await pc.setRemoteDescription(description);
        if (description.type === 'offer') {
          await pc.setLocalDescription();
          this.#send({ description: pc.localDescription.toJSON() });
        }
      } else if (candidate) {
        try { await pc.addIceCandidate(candidate); } catch (err) { if (!this.#ignoreOffer) throw err; }
      }
    } catch (err) {
      console.warn('voice signal failed', err);
    }
  }
}
