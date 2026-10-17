/* English Játszóház app: a stand-in for claude.ai's `room` capability, built on
   PeerJS (WebRTC). The first device in a named room becomes its host (a fixed
   peer id derived from the room name); the others connect to it. The host keeps
   everyone's presence and sends the whole list to all, so the game code sees the
   same {peers:[{peer, presence, sameTab, kind}]} shape it already uses. When the
   host leaves, the others race to become the new host. */
(() => {
  const FAMILY = "nemet-csalad";                      // keeps our room names apart from other users of the free server
  const CFG = window.EJH_PEER || {};                   // test override: {host, port, path, secure}
  const ICE = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }, { urls: "stun:global.stun.twilio.com:3478" }] };
  const rid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
  const opts = () => Object.assign({ debug: 0, config: ICE }, CFG);

  function join(name) {
    const me = rid(), hostId = ("ejh-" + FAMILY + "-" + String(name)).toLowerCase().replace(/[^a-z0-9-]/g, "-");
    let mine = {}, peers = { [me]: mine }, handlers = [], peer = null, hostConn = null, conns = {}, left = false, ready = null, retry = 0;
    const list = () => Object.entries(peers).map(([l, pr]) => ({ peer: l, presence: pr || {}, sameTab: l === me, isMe: l === me, kind: "viewer", by: null, guest: false, updatedAt: Date.now() }));
    const fire = () => { const arr = list(); handlers.forEach(h => { try { h({ peers: arr, joined: [], left: [], updated: [] }); } catch (e) { console.error(e); } }); };
    const broadcast = () => { const m = { t: "peers", peers }; Object.values(conns).forEach(c => { try { if (c.open) c.send(m); } catch (e) {} }); };
    const drop = () => { try { if (peer) peer.destroy(); } catch (e) {} peer = null; hostConn = null; conns = {}; };

    function again() { if (left) return; drop(); peers = { [me]: mine }; fire(); setTimeout(start, 300 + Math.random() * 1200 + Math.min(retry++, 8) * 500); }

    function asHost() {
      peer = new Peer(hostId, opts());
      peer.on("open", () => { retry = 0; peers = { [me]: mine }; fire(); ready && ready.ok(); });
      peer.on("connection", c => {
        const gone = () => { if (c.label && conns[c.label] === c) { delete conns[c.label]; delete peers[c.label]; broadcast(); fire(); } try { c.close(); } catch (e) {} };
        c.gone = gone;
        c.on("data", m => {
          if (!m || typeof m !== "object") return;
          c.seen = Date.now();
          if (m.t === "bye") { gone(); return; }
          if (m.t === "ping") { try { c.send({ t: "pong" }); } catch (e) {} return; }
          if ((m.t === "hello" || m.t === "pres") && typeof m.label === "string") { c.label = m.label; conns[m.label] = c; peers[m.label] = m.pres && typeof m.pres === "object" ? m.pres : {}; broadcast(); fire(); }
        });
        c.on("close", gone); c.on("error", gone);
      });
      peer.on("disconnected", () => { if (!left && peer && !peer.destroyed) try { peer.reconnect(); } catch (e) {} });
      peer.on("error", err => { if (err && err.type === "unavailable-id") { drop(); asClient(); } else if (err && (err.type === "network" || err.type === "server-error" || err.type === "socket-error")) again(); });
    }
    function asClient() {
      peer = new Peer(opts());
      peer.on("open", () => {
        const c = peer.connect(hostId, { reliable: true }); hostConn = c;
        const t = setTimeout(() => { if (!c.open) again(); }, 8000);
        c.on("open", () => { clearTimeout(t); retry = 0; c.seen = Date.now(); c.send({ t: "hello", label: me, pres: mine }); ready && ready.ok(); });
        c.on("data", m => { c.seen = Date.now(); if (m && m.t === "peers" && m.peers && typeof m.peers === "object") { peers = Object.assign({}, m.peers, { [me]: mine }); fire(); } });
        c.on("close", again); c.on("error", again);
      });
      peer.on("disconnected", () => { if (!left && peer && !peer.destroyed) try { peer.reconnect(); } catch (e) {} });
      peer.on("error", err => { if (err && err.type === "peer-unavailable") { drop(); asHost(); } else again(); });
    }
    function start() { if (!left) asHost(); }
    // heartbeat: a closed iPad or a wifi drop never says goodbye, so silence counts as leaving
    const beat = setInterval(() => {
      if (left) { clearInterval(beat); return; }
      const now = Date.now();
      if (hostConn && hostConn.open) { try { hostConn.send({ t: "ping" }); } catch (e) {} if (now - (hostConn.seen || now) > 7000) again(); }
      Object.values(conns).forEach(c => { if (now - (c.seen || now) > 7000 && c.gone) c.gone(); });
    }, 2000);
    addEventListener("pagehide", () => { if (hostConn && hostConn.open) try { hostConn.send({ t: "bye" }); } catch (e) {} });

    const sub = {
      name,
      presence: async patch => {
        mine = Object.assign({}, mine); Object.entries(patch || {}).forEach(([k, v]) => { if (v === null) delete mine[k]; else mine[k] = v; });
        peers[me] = mine; fire();
        if (hostConn && hostConn.open) try { hostConn.send({ t: "pres", label: me, pres: mine }); } catch (e) {}
        else broadcast();
      },
      peers: list,
      onPeers: (h, onErr) => { handlers.push(h); setTimeout(fire, 0); return () => { handlers = handlers.filter(x => x !== h); }; },
      emit: async () => {}, on: () => () => {},
      leave: async () => { if (hostConn && hostConn.open) try { hostConn.send({ t: "bye" }); } catch (e) {} left = true; setTimeout(drop, 100); }
    };
    return new Promise((ok, no) => {
      const t = setTimeout(() => { ready = null; left = true; drop(); no({ code: "upstream_error", message: "Nem sikerült kapcsolódni (nincs internet?)" }); }, 15000);
      ready = { ok: () => { clearTimeout(t); ready = null; ok(sub); } };
      start();
    });
  }
  const room = { join };
  window.claude = { use: async n => (n === "room" && window.Peer ? room : null) };
})();
