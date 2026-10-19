import React, { useState, useEffect, useRef } from 'react';
import {
  Monitor, Shield, Terminal, Folder, MessageSquare, Cpu, Power,
  Lock, Eye, Camera, RefreshCw, Server, Wifi, Play, Search,
  Settings, ChevronRight, ChevronDown, Key, Download, Upload, Trash2,
  X, Check, AlertTriangle, Send, Activity, User, HardDrive, Plus, Zap,
  Edit3, AlertCircle, Unlock, EyeOff, Copy, Globe, Layers, Sliders,
  Radio, Maximize2, Minimize2, Filter, ArrowRight, Clock, Moon,
  Mic, MicOff, Volume2, Bell, Sparkles
} from 'lucide-react';

const LOCAL_STORAGE_KEY = 'dameware_saved_hosts_v1';

export default function App() {
  // Navigation / View Tabs: 'console' | 'fleet' | 'processes' | 'files' | 'chat' | 'deployment'
  const [activeTab, setActiveTab] = useState('fleet');
  const [isConsoleDrawerOpen, setIsConsoleDrawerOpen] = useState(false);
  const [consoleDrawerTab, setConsoleDrawerTab] = useState('chat'); // 'chat' | 'processes' | 'info'

  // Connection state & State Machine ('disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error')
  const [sessionState, setSessionState] = useState('disconnected');
  const [targetHost, setTargetHost] = useState('');
  const [targetPort, setTargetPort] = useState('6129');
  const [authDomain, setAuthDomain] = useState('WORKGROUP');
  const [username, setUsername] = useState('Administrator');
  const [password, setPassword] = useState('');
  const [targetMac, setTargetMac] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  // Error State & Deployment Progress
  const [connectionError, setConnectionError] = useState(null);
  const [deployStatus, setDeployStatus] = useState(null);

  // Active Session State
  const [agentInfo, setAgentInfo] = useState(null);
  const [frameSrc, setFrameSrc] = useState(null);
  const [frameSvg, setFrameSvg] = useState(null);
  const [fps, setFps] = useState(30);
  const [latency, setLatency] = useState(14);
  const [scaleMode, setScaleMode] = useState('fit');
  const [monitors, setMonitors] = useState([]);
  const [selectedMonitorIndex, setSelectedMonitorIndex] = useState('ALL');
  const [activeMonitor, setActiveMonitor] = useState('Primary Screen');
  const [streamQuality, setStreamQuality] = useState(80);
  const [targetFps, setTargetFps] = useState(30);
  const [isVoiceActive, setIsVoiceActive] = useState(false);


  // Toolbar Actions State
  const [isInputLocked, setIsInputLocked] = useState(false);
  const [isScreenBlackedOut, setIsScreenBlackedOut] = useState(false);
  const [isViewOnly, setIsViewOnly] = useState(false);
  const [sendKeysOpen, setSendKeysOpen] = useState(false);
  const [isPowerMenuOpen, setIsPowerMenuOpen] = useState(false);
  const [openPowerCardId, setOpenPowerCardId] = useState(null);
  const [previewModalHost, setPreviewModalHost] = useState(null);

  // Modals & UI helpers
  const [activeModal, setActiveModal] = useState(null);
  const [setupCommand, setSetupCommand] = useState('');
  const [copiedCode, setCopiedCode] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('ALL');
  const [auditLogs, setAuditLogs] = useState([]);
  const [isLoadingAudit, setIsLoadingAudit] = useState(false);
  const [registeredDevices, setRegisteredDevices] = useState([]);

  // Mouse / Canvas / Screen state

  const isMousePressedRef = useRef(false);
  const canvasRef = useRef(null);
  const screenImgRef = useRef(null);
  const lastMouseMoveRef = useRef(0);
  const [hasFrame, setHasFrame] = useState(false);

  // Persistent Host Directory State
  const [savedHosts, setSavedHosts] = useState(() => {
    try {
      const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const seenIds = new Set();
          const groups = parsed.map((group, gIdx) => ({
            ...group,
            hosts: (group.hosts || [])
              .map((h, hIdx) => {
                let id = h.id || `host-${Date.now()}-${gIdx}-${hIdx}`;
                if (seenIds.has(id)) {
                  id = `${id}-${Math.random().toString(36).substr(2, 5)}`;
                }
                seenIds.add(id);
                return { ...h, id };
              })
              .filter((h, index, self) => self.findIndex(t => t.id === h.id) === index)
          }));
          const hasTargetHost = groups.some(g => (g.hosts || []).some(h => h.ip === '172.17.130.182'));
          if (!hasTargetHost && groups.length > 0) {
            groups[0].hosts.unshift({
              id: 'host-hyperv-vm2',
              name: 'DESKTOP-V1GLV4L (Hyper-V VM)',
              ip: '172.17.130.182',
              port: '6129',
              domain: 'WORKGROUP',
              user: 'Administrator',
              pass: '',
              status: 'ONLINE',
              os: 'Windows 11 Pro',
              cpu: '8%',
              ram: '2.5 / 8.0 GB'
            });
          }
          return groups;
        }
      }
    } catch (e) {}
    return [
      {
        domain: 'KAYITLI SUNUCULARIM (My Saved Hosts)',
        hosts: [
          {
            id: 'host-hyperv-vm2',
            name: 'DESKTOP-V1GLV4L (Hyper-V VM)',
            ip: '172.17.130.182',
            port: '6129',
            domain: 'WORKGROUP',
            user: 'Administrator',
            pass: '',
            status: 'ONLINE',
            os: 'Windows 11 Pro',
            cpu: '8%',
            ram: '2.5 / 8.0 GB'
          },
          {
            id: 'host-1',
            name: 'makine1 (Hyper-V VM)',
            ip: '172.31.132.183',
            port: '6129',
            domain: 'WORKGROUP',
            user: 'makine1',
            pass: '123456',
            status: 'ONLINE',
            os: 'Windows 11 Pro',
            cpu: '14%',
            ram: '3.4 / 8.0 GB'
          }
        ]
      }
    ];
  });

  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(savedHosts));
    } catch (e) {}
  }, [savedHosts]);

  // Fetch dynamic setup command from Node.js Gateway
  useEffect(() => {
    const url = `http://localhost:3001/api/setup-command?target=${encodeURIComponent(targetHost || '')}&port=${encodeURIComponent(targetPort || '6129')}`;
    fetch(url)
      .then(res => res.json())
      .then(data => {
        if (data && data.cmd) {
          setSetupCommand(data.cmd);
        }
      })
      .catch(err => {
        // Fallback command if server offline
        setSetupCommand(
          `powershell -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; New-Item C:\\RemoteMM -ItemType Directory -Force | Out-Null; Stop-Process -Name RemoteMM_Agent -Force -ErrorAction SilentlyContinue; Invoke-WebRequest 'http://172.21.16.1:3001/RemoteMM_Agent.exe' -OutFile C:\\RemoteMM\\RemoteMM_Agent.exe -UseBasicParsing; netsh advfirewall firewall add rule name=RemoteMMAgent dir=in action=allow protocol=TCP localport=6129 2>&1 | Out-Null; schtasks /delete /tn RemoteMMAgent /f 2>&1 | Out-Null; schtasks /create /tn RemoteMMAgent /tr 'C:\\RemoteMM\\RemoteMM_Agent.exe' /ru 'SYSTEM' /sc ONSTART /rl HIGHEST /f; schtasks /run /tn RemoteMMAgent"`
        );
      });
  }, [targetHost, targetPort, activeModal]);

  // Form States
  const [editingHost, setEditingHost] = useState(null);
  const [newHostName, setNewHostName] = useState('');
  const [newHostIp, setNewHostIp] = useState('');
  const [newHostUser, setNewHostUser] = useState('Administrator');
  const [newHostPass, setNewHostPass] = useState('');
  const [newHostDomain, setNewHostDomain] = useState('WORKGROUP');

  // Live Chat State
  const [chatMessages, setChatMessages] = useState([
    { sender: 'System NOC', text: 'Encrypted RemoteMM Control Session ready. Port 6129 open.', time: new Date().toLocaleTimeString() }
  ]);
  const [chatInput, setChatInput] = useState('');

  // File Transfer State
  const [remotePath, setRemotePath] = useState('C:\\');
  const [remoteDrives, setRemoteDrives] = useState(['C:\\']);
  const [remoteFiles, setRemoteFiles] = useState([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [fileSearch, setFileSearch] = useState('');
  const fileInputRef = useRef(null);

  // Processes State
  const [processes, setProcesses] = useState([
    { Id: 1024, ProcessName: 'RemoteMM_Agent.exe', CPU: '1.2%', WorkingSet64: 34500000, User: 'SYSTEM' },
    { Id: 408, ProcessName: 'svchost.exe', CPU: '0.4%', WorkingSet64: 82100000, User: 'SYSTEM' },
    { Id: 2190, ProcessName: 'explorer.exe', CPU: '2.8%', WorkingSet64: 114200000, User: 'makine1' },
    { Id: 3400, ProcessName: 'taskmgr.exe', CPU: '0.9%', WorkingSet64: 28900000, User: 'makine1' }
  ]);

  const socketRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const reconnectCountRef = useRef(0);
  const lastHostRef = useRef(null);
  const isCancelledRef = useRef(false);
  const frameCountRef = useRef(0);
  const lastFpsCalcRef = useRef(Date.now());
  const lastKeySentRef = useRef({ key: '', time: 0 });
  const audioContextRef = useRef(null);
  const audioStreamRef = useRef(null);
  const processorRef = useRef(null);
  const chatEndRef = useRef(null);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages]);

  const encodeWAV = (samples, sampleRate = 16000) => {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    let offset = 44;
    for (let i = 0; i < samples.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return new Uint8Array(buffer);
  };

  const uint8ToBase64 = (u8) => {
    let binary = '';
    const len = u8.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(u8[i]);
    }
    return btoa(binary);
  };

  const startVoiceIntercom = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Mikrofon kullanımı için HTTPS veya localhost bağlantısı gereklidir.');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 16000 } });
      audioStreamRef.current = stream;
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx({ sampleRate: 16000 });
      audioContextRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        let maxVal = 0;
        for (let i = 0; i < inputData.length; i++) {
          const abs = Math.abs(inputData[i]);
          if (abs > maxVal) maxVal = abs;
        }
        if (maxVal < 0.02) return; // Sessizlik durumunda gereksiz paket iletme

        const wavBytes = encodeWAV(inputData, 16000);
        const b64 = uint8ToBase64(wavBytes);
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
          socketRef.current.send(JSON.stringify({ type: 'AUDIO_CHUNK', data: b64 }));
        }
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);
      setIsVoiceActive(true);
    } catch (err) {
      console.error('Mikrofon erişim hatası:', err);
      alert('Mikrofon başlatılamadı: ' + err.message);
      setIsVoiceActive(false);
    }
  };

  const stopVoiceIntercom = () => {
    if (processorRef.current) {
      try { processorRef.current.disconnect(); } catch (_) {}
      processorRef.current = null;
    }
    if (audioStreamRef.current) {
      try { audioStreamRef.current.getTracks().forEach(t => t.stop()); } catch (_) {}
      audioStreamRef.current = null;
    }
    if (audioContextRef.current) {
      try { audioContextRef.current.close(); } catch (_) {}
      audioContextRef.current = null;
    }
    setIsVoiceActive(false);
  };

  const toggleVoiceIntercom = async () => {
    if (isVoiceActive) {
      stopVoiceIntercom();
    } else {
      await startVoiceIntercom();
    }
  };

  const sendAudioBeep = () => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'AUDIO_BEEP' }));
    }
  };

  const changeStreamQuality = (newQuality) => {
    setStreamQuality(newQuality);
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'SET_QUALITY', quality: newQuality }));
    }
  };

  const changeTargetFps = (newFps) => {
    setTargetFps(newFps);
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'SET_FPS', fps: newFps }));
    }
  };

  const changeMonitor = (monitorIdx) => {
    setSelectedMonitorIndex(monitorIdx);
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({
        type: 'SELECT_MONITOR',
        monitorIndex: monitorIdx
      }));
    }
  };


  // SINGLE ACTIVE CONNECTION ENFORCER
  const handleConnect = (hostObj = null, options = {}) => {
    isCancelledRef.current = false;
    const forceReinstall = Boolean(options?.forceReinstall);

    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.onclose = null;
      socketRef.current.onerror = null;
      socketRef.current.onmessage = null;
      socketRef.current.close();
      socketRef.current = null;
    }

    let target = targetHost;
    let p = targetPort;
    let d = authDomain;
    let u = username;
    let pass = password;
    let mac = targetMac;

    if (hostObj) {
      target = hostObj.ip || hostObj.name;
      p = hostObj.port || '6129';
      d = hostObj.domain || 'WORKGROUP';
      u = hostObj.user || 'Administrator';
      pass = hostObj.pass || '';
      mac = hostObj.mac || '';

      setTargetHost(target);
      setTargetPort(p);
      setAuthDomain(d);
      setUsername(u);
      setPassword(pass);
      setTargetMac(mac);
    }

    if (!target.trim()) return;

    reconnectCountRef.current = 0;
    lastHostRef.current = hostObj || { ip: target, port: p, domain: d, user: u, pass, mac };

    setIsConnected(false);
    setIsConnecting(true);
    setIsScreenBlackedOut(false);
    setIsInputLocked(false);
    setConnectionError(null);
    setDeployStatus(forceReinstall ? 'Zorla yeniden kurulum ve güncelleme başlatılıyor...' : null);
    setFrameSrc(null);
    setFrameSvg(null);
    setHasFrame(false);
    setAgentInfo(null);
    setActiveTab('console'); // Switch to live stream viewport immediately

    const wsUrl = `ws://localhost:3001/?host=${target}&port=${p}&domain=${encodeURIComponent(d)}&username=${encodeURIComponent(u)}&password=${encodeURIComponent(pass)}${mac ? `&mac=${encodeURIComponent(mac)}` : ''}${forceReinstall ? '&force=true' : ''}`;
    const ws = new WebSocket(wsUrl);
    socketRef.current = ws;

    ws.onopen = () => {
      console.log(`[RemoteMM NOC] Gateway connected for target: ${target} (mac: ${mac || 'auto'}, forceReinstall: ${forceReinstall})`);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'CONNECTION_ERROR') {
          setIsConnecting(false);
          setIsConnected(false);
          setSessionState('error');
          setConnectionError({ code: data.errorCode, message: data.errorMessage });
        } else if (data.type === 'DEPLOYMENT_PROGRESS') {
          setDeployStatus(data.message);
        } else if (data.type === 'HANDSHAKE_ACK') {
          setIsConnecting(false);
          setIsConnected(true);
          setSessionState('connected');
          reconnectCountRef.current = 0;
          setAgentInfo(data);
          if (data.monitors && Array.isArray(data.monitors)) {
            setMonitors(data.monitors);
          }
          setDeployStatus(null);
          setConnectionError(null);

          setIsScreenBlackedOut(false);
          setIsInputLocked(false);
          if (data.macAddress) {
            setTargetMac(data.macAddress.toUpperCase());
            setSavedHosts(prev => prev.map(group => ({
              ...group,
              hosts: group.hosts.map(h => {
                if (h.ip === target || h.name === target) {
                  return { ...h, mac: data.macAddress.toUpperCase() };
                }
                return h;
              })
            })));
          }
          if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({ type: 'BLACKOUT_SCREEN', blackout: false }));
            socketRef.current.send(JSON.stringify({ type: 'LOCK_INPUT', locked: false }));
            socketRef.current.send(JSON.stringify({ type: 'SET_FPS', fps: 0 })); // 0 = Auto Max Unlocked
            socketRef.current.send(JSON.stringify({ type: 'SET_QUALITY', quality: 88 })); // Ultra HD
          }
          setTimeout(() => { if (canvasRef.current) canvasRef.current.focus(); }, 300);
        } else if (data.type === 'SCREEN_FRAME') {
          setIsConnecting(false);
          setIsConnected(true);
          setSessionState('connected');
          setDeployStatus(null);
          setConnectionError(null);
          if (data.frame) {
            if (screenImgRef.current) {
              screenImgRef.current.src = `data:image/jpeg;base64,${data.frame}`;
            }
            if (!hasFrame) setHasFrame(true);
            frameCountRef.current++;
            const now = Date.now();
            if (now - lastFpsCalcRef.current >= 1000) {
              setFps(Math.max(1, Math.round((frameCountRef.current * 1000) / (now - lastFpsCalcRef.current))));
              frameCountRef.current = 0;
              lastFpsCalcRef.current = now;
            }
            if (data.blackedOut !== undefined) {
              setIsScreenBlackedOut(Boolean(data.blackedOut));
            }
          }
        } else if (data.type === 'PONG') {
          if (data.timestamp) {
            setLatency(Math.max(1, Date.now() - data.timestamp));
          }
        } else if (data.type === 'CHAT_BROADCAST') {
          setChatMessages(data.messages);
        } else if (data.type === 'FS_LIST_RES') {
          setRemotePath(data.path);
          if (data.drives && data.drives.length > 0) setRemoteDrives(data.drives);
          setRemoteFiles(data.entries || []);
          setIsLoadingFiles(false);
        } else if (data.type === 'FS_DOWNLOAD_RES') {
          try {
            const byteCharacters = atob(data.data);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
              byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray]);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = data.filename || 'download';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          } catch (err) {
            alert('Dosya indirilemedi: ' + err.message);
          }
        } else if (data.type === 'FS_UPLOAD_RES') {
          alert('Dosya uzak makineye başarıyla yüklendi!');
          if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({ type: 'FS_LIST', path: data.path ? data.path.substring(0, data.path.lastIndexOf('\\')) || 'C:\\' : 'C:\\' }));
          }
        } else if (data.type === 'FS_DELETE_RES' || data.type === 'FS_MKDIR_RES') {
          if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({ type: 'FS_LIST', path: remotePath }));
          }
        } else if (data.type === 'FS_EXEC_RES') {
          alert('Uzak makinede dosya çalıştırıldı!');
        } else if (data.type === 'FS_ERROR') {
          alert('Uzak Dosya Hatası: ' + data.message);
          setIsLoadingFiles(false);
        } else if (data.type === 'TASK_LIST_RES') {
          if (data.processes && data.processes.length > 0) {
            setProcesses(data.processes);
          }
        } else if (data.type === 'PONG') {
          if (data.timestamp) {
            setLatency(Math.max(1, Date.now() - data.timestamp));
          }
        } else if (data.type === 'MONITOR_LIST') {
          if (data.monitors && Array.isArray(data.monitors)) {
            setMonitors(data.monitors);
          }
        }
      } catch (e) {

        console.warn('[RemoteMM] ws message parse error:', e);
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      setIsConnecting(false);

      // Auto-reconnect with exponential backoff (up to 5 attempts)
      if (reconnectCountRef.current < 5 && lastHostRef.current && !isCancelledRef.current) {
        reconnectCountRef.current++;
        setSessionState('reconnecting');
        const delay = Math.min(15000, Math.round(1500 * Math.pow(1.5, reconnectCountRef.current - 1)));
        console.log(`[RemoteMM] Connection dropped. Auto-reconnecting (Attempt ${reconnectCountRef.current}/5 in ${delay}ms)...`);
        reconnectTimerRef.current = setTimeout(() => {
          handleConnect(lastHostRef.current);
        }, delay);
      } else {
        setSessionState('disconnected');
      }
    };

    ws.onerror = () => {
      setIsConnecting(false);
      setSessionState('error');
      setConnectionError({
        code: 'ERR_GATEWAY_OFFLINE',
        message: 'RemoteMM Gateway backend is offline on port 3001. Run "npm run server" or restart the gateway.'
      });
    };
  };

  const handleDisconnect = () => {
    isCancelledRef.current = true;
    reconnectCountRef.current = 0;
    lastHostRef.current = null;
    setSessionState('disconnected');
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.onclose = null;
      socketRef.current.onerror = null;
      socketRef.current.onmessage = null;
      socketRef.current.close();
      socketRef.current = null;
    }
    setIsConnected(false);
    setIsConnecting(false);
    setIsScreenBlackedOut(false);
    setIsInputLocked(false);
    stopVoiceIntercom();
    setAgentInfo(null);
    setFrameSrc(null);
    setFrameSvg(null);
    setHasFrame(false);
  };

  // Ping interval to keep latency indicator updated
  useEffect(() => {
    if (!isConnected) return;
    const interval = setInterval(() => {
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: 'PING', timestamp: Date.now() }));
      }
    }, 2500);
    return () => clearInterval(interval);
  }, [isConnected]);

  // Keyboard forwarding
  const handleKeyDown = (e) => {
    if (!isConnected || isViewOnly) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

    let keyToSend = null;

    // Windows / Meta Key
    if (e.key === 'Meta' || e.key === 'OS' || e.code === 'MetaLeft' || e.code === 'MetaRight') {
      keyToSend = 'WIN_KEY';
      e.preventDefault();
    }
    // Combinations
    else if (e.altKey && e.key === 'Tab') {
      keyToSend = 'ALT_TAB';
      e.preventDefault();
    }
    else if (e.altKey && (e.key === 'F4' || e.code === 'F4')) {
      keyToSend = 'ALT_F4';
      e.preventDefault();
    }
    else if (e.ctrlKey && e.altKey && (e.key === 'Delete' || e.key === 'End' || e.code === 'Delete')) {
      keyToSend = 'CAD';
      e.preventDefault();
    }
    // Special Navigation & Control keys
    else if (e.key === 'Enter') keyToSend = '{ENTER}';
    else if (e.key === 'Backspace') keyToSend = '{BACKSPACE}';
    else if (e.key === 'Tab') { keyToSend = '{TAB}'; e.preventDefault(); }
    else if (e.key === 'Escape') keyToSend = '{ESC}';
    else if (e.key === 'Delete') keyToSend = '{DELETE}';
    else if (e.key === 'ArrowUp') { keyToSend = '{UP}'; e.preventDefault(); }
    else if (e.key === 'ArrowDown') { keyToSend = '{DOWN}'; e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { keyToSend = '{LEFT}'; e.preventDefault(); }
    else if (e.key === 'ArrowRight') { keyToSend = '{RIGHT}'; e.preventDefault(); }
    else if (e.key === 'Home') keyToSend = '{HOME}';
    else if (e.key === 'End') keyToSend = '{END}';
    else if (e.key === 'PageUp') keyToSend = '{PAGEUP}';
    else if (e.key === 'PageDown') keyToSend = '{PAGEDOWN}';
    else if (e.key === 'Insert') keyToSend = '{INSERT}';
    else if (e.key === 'PrintScreen') keyToSend = '{PRTSCN}';
    else if (/^F([1-9]|1[0-2])$/.test(e.key)) {
      keyToSend = e.key;
      e.preventDefault();
    }
    // Ignore modifier keys alone
    else if (['Shift', 'Control', 'Alt', 'CapsLock', 'NumLock', 'ScrollLock'].includes(e.key)) {
      return;
    }
    // Single character keys
    else if (e.key.length === 1) {
      keyToSend = e.key;
    }

    if (keyToSend && socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      const now = Date.now();
      if (lastKeySentRef.current.key === keyToSend && now - lastKeySentRef.current.time < 50 && !e.repeat) {
        return;
      }
      lastKeySentRef.current = { key: keyToSend, time: now };
      socketRef.current.send(JSON.stringify({
        type: 'KEYBOARD_INPUT',
        key: keyToSend
      }));
    }
  };

  // Global keyboard capture when in live console view
  useEffect(() => {
    if (!isConnected || activeTab !== 'console') return;
    const onGlobalKeyDown = (e) => {
      if (
        e.target.tagName === 'INPUT' ||
        e.target.tagName === 'TEXTAREA' ||
        e.target.isContentEditable ||
        (e.target.closest && e.target.closest('[data-chat-panel]'))
      ) return;
      handleKeyDown(e);
    };
    window.addEventListener('keydown', onGlobalKeyDown);
    return () => window.removeEventListener('keydown', onGlobalKeyDown);
  }, [isConnected, activeTab, isViewOnly]);

  const sendSpecialKey = (keyName) => {
    setSendKeysOpen(false);
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({
        type: 'KEYBOARD_INPUT',
        key: keyName
      }));
    }
  };

  const toggleLockInput = () => {
    const nextState = !isInputLocked;
    setIsInputLocked(nextState);
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({
        type: 'LOCK_INPUT',
        locked: nextState
      }));
    }
  };

  const toggleBlackoutScreen = () => {
    const nextState = !isScreenBlackedOut;
    setIsScreenBlackedOut(nextState);
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({
        type: 'BLACKOUT_SCREEN',
        blackout: nextState
      }));
    }
  };

  const triggerWakeOnLan = async (hostOrMac, hostIp = '') => {
    let mac = '';
    let ip = '';
    if (typeof hostOrMac === 'object' && hostOrMac !== null) {
      mac = hostOrMac.mac || '';
      ip = hostOrMac.ip || '';
    } else if (typeof hostOrMac === 'string') {
      mac = hostOrMac;
      ip = hostIp;
    }
    try {
      const res = await fetch('http://localhost:3001/api/power/wol', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mac, ip })
      });
      const data = await res.json();
      if (data.success) {
        alert(`⚡ Wake-on-LAN sihirli paketi (${data.mac}) gönderildi! Bilgisayar uyanıyor...`);
      } else {
        alert(`❌ WoL Hatası: ${data.error}`);
      }
    } catch (e) {
      alert(`WoL isteği başarısız: ${e.message}`);
    }
    setIsPowerMenuOpen(false);
  };

  const sendPowerAction = (actionType) => {
    const actionLabels = {
      shutdown: 'Bilgisayarı Kapat',
      reboot: 'Yeniden Başlat',
      sleep: 'Uyku Modu',
      hibernate: 'Hazırda Beklet',
      lock: 'Oturumu Kilitle',
      logoff: 'Oturumu Kapat',
      abort: 'Kapatmayı İptal Et'
    };
    const label = actionLabels[actionType] || actionType.toUpperCase();
    if (confirm(`Uzak makinede [${label}] işlemini onaylıyor musunuz?`)) {
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({
          type: 'POWER_ACTION',
          action: actionType
        }));
      }
      setIsPowerMenuOpen(false);
      setActiveModal(null);
    }
  };

  const handleRemotePowerAction = async (h, actionType) => {
    const actionLabels = {
      shutdown: 'Bilgisayarı Kapat',
      reboot: 'Yeniden Başlat',
      sleep: 'Uyku Modu',
      hibernate: 'Hazırda Beklet',
      lock: 'Oturumu Kilitle',
      logoff: 'Oturumu Kapat',
      abort: 'Kapatmayı İptal Et'
    };
    const label = actionLabels[actionType] || actionType.toUpperCase();
    if (!confirm(`"${h.name}" (${h.ip}) üzerinde [${label}] işlemini uygulamak istiyor musunuz?`)) {
      return;
    }

    try {
      const res = await fetch('http://localhost:3001/api/power/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetHost: h.ip || h.name,
          port: h.port || '6129',
          action: actionType
        })
      });
      const data = await res.json();
      if (data.success) {
        alert(`⚡ [${label}] komutu başarıyla iletildi! (${data.method || 'işlem uygulandı'})`);
        setTimeout(() => pollFleetStatus(), 2000);
      } else {
        alert(`❌ İşlem hatası: ${data.error || data.err || 'Uzak makine yanıt vermedi'}`);
      }
    } catch (e) {
      alert(`İstek başarısız: ${e.message}`);
    }
    setOpenPowerCardId(null);
  };

  const handleSendChat = (e) => {
    e.preventDefault();
    const textToSend = chatInput.trim();
    if (!textToSend) return;

    const newMessage = {
      sender: 'Technician (You)',
      text: textToSend,
      time: new Date().toLocaleTimeString()
    };

    setChatMessages(prev => [...prev, newMessage]);
    setChatInput('');

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({
        type: 'CHAT_MESSAGE',
        text: textToSend
      }));
    } else {
      alert('⚠️ Canlı bağlantı aktif değil. Karşı makineye mesaj iletmek için lütfen Canlı Konsol üzerinden bir istemciye bağlanın.');
    }
  };

  const handleKillProcess = (processId) => {
    setProcesses(prev => prev.filter(p => p.Id !== processId));
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({
        type: 'KILL_PROCESS',
        pid: processId
      }));
    }
  };

  // Mouse Input Handler
  const sendMouseInput = (action, e, extra = {}) => {
    if (!isConnected || isViewOnly) return;

    const container = e.currentTarget || e.target?.closest('[data-remote-canvas]');
    if (!container) return;
    const imgEl = container.querySelector('img');

    const containerRect = container.getBoundingClientRect();
    let xPercent, yPercent;

    const remoteW = agentInfo?.screenWidth || 1920;
    const remoteH = agentInfo?.screenHeight || 1080;
    const naturalAspect = remoteW / remoteH;

    if (scaleMode === 'fit') {
      const containerWidth = containerRect.width;
      const containerHeight = containerRect.height;
      const containerAspect = containerWidth / containerHeight;

      let renderedWidth, renderedHeight, leftOffset, topOffset;
      if (containerAspect > naturalAspect) {
        renderedHeight = containerHeight;
        renderedWidth = containerHeight * naturalAspect;
        leftOffset = containerRect.left + (containerWidth - renderedWidth) / 2;
        topOffset = containerRect.top;
      } else {
        renderedWidth = containerWidth;
        renderedHeight = containerWidth / naturalAspect;
        leftOffset = containerRect.left;
        topOffset = containerRect.top + (containerHeight - renderedHeight) / 2;
      }
      xPercent = (e.clientX - leftOffset) / renderedWidth;
      yPercent = (e.clientY - topOffset) / renderedHeight;
    } else if (scaleMode === '100%') {
      const imgRect = imgEl ? imgEl.getBoundingClientRect() : containerRect;
      xPercent = (e.clientX - imgRect.left) / imgRect.width;
      yPercent = (e.clientY - imgRect.top) / imgRect.height;
    } else {
      // stretch
      xPercent = (e.clientX - containerRect.left) / containerRect.width;
      yPercent = (e.clientY - containerRect.top) / containerRect.height;
    }

    xPercent = Math.max(0, Math.min(1, xPercent));
    yPercent = Math.max(0, Math.min(1, yPercent));

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({
        type: 'MOUSE_INPUT',
        action,
        button: e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left',
        xPercent,
        yPercent,
        ...extra
      }));
    }
  };

  const sendScrollInput = (e) => {
    if (!isConnected || isViewOnly) return;
    const delta = e.deltaY > 0 ? -1 : 1;
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'MOUSE_INPUT', action: 'scroll', delta }));
    }
  };

  const handleMouseDown = (e) => {
    isMousePressedRef.current = true;
    if (canvasRef.current) canvasRef.current.focus();
    sendMouseInput('mousedown', e);
  };

  const handleMouseUp = (e) => {
    isMousePressedRef.current = false;
    sendMouseInput('mouseup', e);
  };

  const handleMouseMove = (e) => {
    const now = performance.now();
    if (now - lastMouseMoveRef.current < 16) return;
    lastMouseMoveRef.current = now;
    sendMouseInput('move', e);
  };

  const handleOpenEditHost = (host) => {
    setEditingHost({ ...host });
    setActiveModal('editHostSettings');
  };

  const handleSaveHostSettings = (e) => {
    e.preventDefault();
    if (!editingHost) return;

    setSavedHosts(prev => {
      return prev.map(group => ({
        ...group,
        hosts: group.hosts.map(h => (h.id === editingHost.id ? editingHost : h))
      }));
    });

    setActiveModal(null);
    setEditingHost(null);
  };

  const handleDeleteHost = (hostId) => {
    setSavedHosts(prev => {
      return prev.map(group => ({
        ...group,
        hosts: group.hosts.filter(h => h.id !== hostId)
      }));
    });
    setActiveModal(null);
    setEditingHost(null);
  };

  const handleAddHost = (e) => {
    e.preventDefault();
    if (!newHostName.trim() || !newHostIp.trim()) return;

    const newEntry = {
      id: `host-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      name: newHostName,
      ip: newHostIp,
      port: '6129',
      domain: newHostDomain || 'WORKGROUP',
      user: newHostUser || 'Administrator',
      pass: newHostPass || '',
      status: 'ONLINE',
      os: 'Windows 11 Pro',
      cpu: '8%',
      ram: '2.8 / 16.0 GB'
    };

    setSavedHosts(prev => {
      const updated = [...prev];
      if (updated.length === 0) {
        updated.push({ domain: 'KAYITLI SUNUCULARIM (My Saved Hosts)', hosts: [newEntry] });
      } else {
        updated[0].hosts.unshift(newEntry);
      }
      return updated;
    });

    setNewHostName('');
    setNewHostIp('');
    setNewHostUser('Administrator');
    setNewHostPass('');
    setActiveModal(null);
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2200);
  };

  // Flatten and deduplicate hosts for fleet stats & filters
  const allHosts = React.useMemo(() => {
    const seen = new Set();
    const unique = [];
    for (const group of savedHosts) {
      for (const h of (group.hosts || [])) {
        if (!seen.has(h.id)) {
          seen.add(h.id);
          unique.push(h);
        }
      }
    }
    return unique;
  }, [savedHosts]);

  const filteredHosts = allHosts.filter(h => {
    const matchesSearch =
      h.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
      h.ip.toLowerCase().includes(searchFilter.toLowerCase()) ||
      h.user.toLowerCase().includes(searchFilter.toLowerCase());
    const matchesGroup = selectedGroup === 'ALL' || h.domain === selectedGroup;
    return matchesSearch && matchesGroup;
  });

  // Fleet Live Monitoring & Snapshots State
  const [hostStatuses, setHostStatuses] = useState({});
  const [hostSnapshots, setHostSnapshots] = useState({});
  const [isLivePreviewEnabled, setIsLivePreviewEnabled] = useState(true);
  const [isPollingFleet, setIsPollingFleet] = useState(false);

  const onlineCount = allHosts.filter(h => hostStatuses[h.id]?.online).length;
  const offlineCount = allHosts.length - onlineCount;

  const pollFleetStatus = async (hostsToPoll = allHosts, fetchSnaps = isLivePreviewEnabled) => {
    if (!hostsToPoll || hostsToPoll.length === 0) return;
    setIsPollingFleet(true);
    try {
      const res = await fetch('http://localhost:3001/api/fleet/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hosts: hostsToPoll.map(h => ({
            id: h.id,
            ip: h.ip || h.name,
            port: h.port || '6129'
          }))
        })
      });
      if (!res.ok) return;
      const data = await res.json().catch(() => null);
      if (!data) return;

      const statusMap = data.statuses || data.results;
      if (statusMap) {
        setHostStatuses(prev => {
          const next = { ...prev };
          Object.keys(statusMap).forEach(key => {
            const item = statusMap[key];
            next[key] = {
              online: item.online,
              latency: item.latency,
              lastChecked: Date.now()
            };
          });
          return next;
        });

        if (fetchSnaps) {
          const onlineKeys = Object.keys(statusMap).filter(k => statusMap[k]?.online);
          await Promise.allSettled(
            onlineKeys.map(async (key) => {
              const h = hostsToPoll.find(x => x.id === key || x.ip === key);
              if (!h) return;
              const hostTarget = h.ip || h.name;
              const portTarget = h.port || '6129';
              try {
                const snapRes = await fetch(`http://localhost:3001/api/fleet/snapshot?host=${encodeURIComponent(hostTarget)}&port=${encodeURIComponent(portTarget)}&fresh=true`);
                if (!snapRes.ok) return;
                const snapData = await snapRes.json().catch(() => null);
                const rawFrame = snapData?.frame || snapData?.snapshot;
                if (snapData && snapData.success && rawFrame) {
                  const dataUri = rawFrame.startsWith('data:') ? rawFrame : `data:image/jpeg;base64,${rawFrame}`;
                  setHostSnapshots(prev => ({
                    ...prev,
                    [h.id]: {
                      snapshot: dataUri,
                      user: snapData.user,
                      width: snapData.width,
                      height: snapData.height,
                      timestamp: Date.now()
                    }
                  }));
                }
              } catch (err) {
                // Ignore transient snapshot failures
              }
            })
          );
        }
      }
    } catch (e) {
      // Ignore background poll errors silently
    } finally {
      setIsPollingFleet(false);
    }
  };

  // Auto-poll fleet online status & screen previews when viewing Fleet tab (Every 3 seconds for live surveillance)
  useEffect(() => {
    if (activeTab !== 'fleet') return;
    pollFleetStatus(allHosts, isLivePreviewEnabled);

    const interval = setInterval(() => {
      pollFleetStatus(allHosts, isLivePreviewEnabled);
    }, 3000);

    return () => clearInterval(interval);
  }, [activeTab, allHosts, isLivePreviewEnabled]);

  const requestFsList = (path) => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;
    setIsLoadingFiles(true);
    socketRef.current.send(JSON.stringify({ type: 'FS_LIST', path }));
  };

  const handleNavigate = (folderName) => {
    let newPath;
    if (folderName === '..') {
      const parts = remotePath.replace(/\\$/, '').split('\\');
      if (parts.length <= 1) {
        newPath = remotePath.endsWith('\\') ? remotePath : `${remotePath}\\`;
      } else {
        parts.pop();
        newPath = parts.join('\\');
        if (newPath.length === 2 && newPath[1] === ':') newPath += '\\';
      }
    } else {
      newPath = remotePath.endsWith('\\') ? `${remotePath}${folderName}` : `${remotePath}\\${folderName}`;
    }
    requestFsList(newPath);
  };

  const handleDownloadFile = (file) => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;
    const fullPath = remotePath.endsWith('\\') ? `${remotePath}${file.name}` : `${remotePath}\\${file.name}`;
    socketRef.current.send(JSON.stringify({ type: 'FS_DOWNLOAD', path: fullPath }));
  };

  const handleDeleteFile = (file) => {
    if (!confirm(`"${file.name}" dosyasını veya klasörünü uzak sunucudan silmek istediğinize emin misiniz?`)) return;
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;
    const fullPath = remotePath.endsWith('\\') ? `${remotePath}${file.name}` : `${remotePath}\\${file.name}`;
    socketRef.current.send(JSON.stringify({ type: 'FS_DELETE', path: fullPath }));
  };

  const handleCreateFolder = () => {
    const folderName = prompt('Oluşturulacak yeni klasör adını girin:');
    if (!folderName || !folderName.trim()) return;
    const fullPath = remotePath.endsWith('\\') ? `${remotePath}${folderName.trim()}` : `${remotePath}\\${folderName.trim()}`;
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'FS_MKDIR', path: fullPath }));
    }
  };

  const handleUploadFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      alert('Dosya boyutu en fazla 25MB olabilir.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64Data = reader.result.split(',')[1];
      const fullPath = remotePath.endsWith('\\') ? `${remotePath}${file.name}` : `${remotePath}\\${file.name}`;
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({
          type: 'FS_UPLOAD',
          path: fullPath,
          data: base64Data
        }));
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleExecuteFile = (file) => {
    if (!confirm(`"${file.name}" dosyasını uzak sunucuda (SYSTEM yetkisiyle) çalıştırmak istiyor musunuz?`)) return;
    const fullPath = remotePath.endsWith('\\') ? `${remotePath}${file.name}` : `${remotePath}\\${file.name}`;
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'FS_EXEC', path: fullPath }));
    }
  };

  const fetchAuditLogs = async () => {
    setIsLoadingAudit(true);
    try {
      const res = await fetch('http://localhost:3001/api/audit/logs?limit=100');
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.logs)) {
          setAuditLogs(data.logs);
        }
      }
    } catch (err) {
      console.warn('[RemoteMM] Could not fetch audit logs:', err);
    } finally {
      setIsLoadingAudit(false);
    }
  };

  const fetchRegisteredDevices = async () => {
    try {
      const res = await fetch('http://localhost:3001/api/devices');
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.devices)) {
          setRegisteredDevices(data.devices);
        }
      }
    } catch (err) {
      console.warn('[RemoteMM] Could not fetch registered devices:', err);
    }
  };

  useEffect(() => {
    fetchRegisteredDevices();
    const interval = setInterval(fetchRegisteredDevices, 4000);
    return () => clearInterval(interval);
  }, []);

  // Auto trigger FS_LIST or TASK_LIST when switching tabs
  useEffect(() => {
    if (activeTab === 'audit') {
      fetchAuditLogs();
    }
    if (activeTab === 'fleet') {
      fetchRegisteredDevices();
    }

    if (isConnected && socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      if (activeTab === 'files') {
        requestFsList(remotePath || 'C:\\');
      } else if (activeTab === 'processes') {
        socketRef.current.send(JSON.stringify({ type: 'TASK_LIST' }));
      }
    }
  }, [activeTab, isConnected]);

  return (
    <div className="flex flex-col h-screen w-screen bg-[#060911] text-slate-100 select-none overflow-hidden font-sans">
      
      {/* ─────────────────────────────────────────────────────────────
          TOP ENTERPRISE NOC CONTROL BAR
      ───────────────────────────────────────────────────────────── */}
      <header className="h-14 bg-[#090e1a]/95 backdrop-blur-md border-b border-slate-800/80 px-4 flex items-center justify-between z-40 shrink-0">
        
        {/* BRAND & NOC STATUS */}
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-br from-cyan-500/20 to-indigo-500/20 border border-cyan-500/30 text-cyan-400 shadow-[0_0_15px_rgba(56,189,248,0.2)]">
            <Server className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-sm tracking-wider bg-gradient-to-r from-cyan-400 via-sky-300 to-indigo-300 bg-clip-text text-transparent">
                RemoteMM
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded font-mono font-bold bg-cyan-950/80 text-cyan-400 border border-cyan-700/50">
                NOC ENTERPRISE
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-800/40 flex items-center gap-1">
                <Shield className="w-2.5 h-2.5 text-emerald-400" /> SYSTEM PRIVILEGE
              </span>
            </div>
            <p className="text-[10px] text-slate-400 flex items-center gap-1.5 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 pulse-dot"></span>
              CLUSTER READY • UIPI BYPASS ACTIVE
            </p>
          </div>
        </div>

        {/* CENTER VIEWPORT / WORKSPACE NAVIGATION PILLS */}
        <nav className="flex items-center gap-1 bg-slate-950/90 p-1 rounded-xl border border-slate-800 shadow-inner">
          <button
            onClick={() => setActiveTab('fleet')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === 'fleet'
                ? 'bg-gradient-to-r from-cyan-500/20 to-sky-500/20 text-cyan-300 border border-cyan-500/30 shadow-[0_0_12px_rgba(56,189,248,0.15)]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            <Server className="w-3.5 h-3.5" /> Sunucu Filosu (NOC)
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-800 text-slate-300 font-mono">
              {allHosts.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('console')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all relative ${
              activeTab === 'console'
                ? 'bg-gradient-to-r from-indigo-500/20 to-cyan-500/20 text-cyan-300 border border-cyan-500/30 shadow-[0_0_12px_rgba(56,189,248,0.15)]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            <Monitor className="w-3.5 h-3.5" /> Canlı Konsol
            {isConnected ? (
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
            ) : isConnecting ? (
              <RefreshCw className="w-3 h-3 animate-spin text-amber-400" />
            ) : null}
          </button>

          <button
            onClick={() => setActiveTab('processes')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === 'processes'
                ? 'bg-gradient-to-r from-cyan-500/20 to-sky-500/20 text-cyan-300 border border-cyan-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" /> Süreçler & Güç
          </button>

          <button
            onClick={() => setActiveTab('files')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === 'files'
                ? 'bg-gradient-to-r from-cyan-500/20 to-sky-500/20 text-cyan-300 border border-cyan-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            <Folder className="w-3.5 h-3.5" /> Dosyalar
          </button>

          <button
            onClick={() => {
              setActiveTab('chat');
              if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
                socketRef.current.send(JSON.stringify({ type: 'CHAT_OPEN' }));
              }
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === 'chat'
                ? 'bg-gradient-to-r from-cyan-500/20 to-sky-500/20 text-cyan-300 border border-cyan-500/30 shadow-[0_0_12px_rgba(56,189,248,0.15)]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" /> Ops Sohbet
          </button>

          <button
            onClick={() => setActiveTab('deployment')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === 'deployment'
                ? 'bg-gradient-to-r from-cyan-500/20 to-sky-500/20 text-cyan-300 border border-cyan-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            <Zap className="w-3.5 h-3.5 text-amber-400" /> Otomatik Dağıtım
          </button>

          <button
            onClick={() => {
              setActiveTab('audit');
              fetchAuditLogs();
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === 'audit'
                ? 'bg-gradient-to-r from-cyan-500/20 to-sky-500/20 text-cyan-300 border border-cyan-500/30 shadow-[0_0_12px_rgba(56,189,248,0.15)]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            <Shield className="w-3.5 h-3.5 text-emerald-400" /> Denetim İzi (Audit)
          </button>
        </nav>

        {/* RIGHT NOC TELEMETRY & ACTIONS */}
        <div className="flex items-center gap-3">
          
          {/* Real-time Session Telemetry Indicator */}
          {isConnected ? (
            <div className="flex items-center gap-3 bg-slate-950/80 px-3 py-1 rounded-lg border border-emerald-500/30 font-mono text-xs shadow-[0_0_10px_rgba(16,185,129,0.15)]">
              <div className="flex items-center gap-1.5 text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-400 pulse-dot"></span>
                <span className="font-bold">{agentInfo?.hostname || targetHost}</span>
              </div>
              <div className="h-3 w-px bg-slate-800"></div>
              <span className="text-slate-400 text-[11px]">FPS: <strong className="text-cyan-400">{fps}</strong></span>
              <span className="text-slate-400 text-[11px]">PING: <strong className="text-emerald-400">{latency}ms</strong></span>
              <button
                onClick={handleDisconnect}
                className="px-2 py-0.5 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/40 text-[11px] font-semibold transition"
              >
                Disconnect
              </button>
            </div>
          ) : sessionState === 'reconnecting' ? (
            <div className="flex items-center gap-2 bg-slate-950/90 px-3 py-1 rounded-lg border border-amber-500/40 text-[11px] text-amber-300 font-mono shadow-[0_0_12px_rgba(245,158,11,0.2)]">
              <RefreshCw className="w-3 h-3 animate-spin text-amber-400" />
              <span>Yeniden Bağlanıyor ({reconnectCountRef.current}/5)...</span>
              <button
                onClick={handleDisconnect}
                className="ml-1 px-1.5 py-0.2 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 text-[10px]"
              >
                İptal
              </button>
            </div>
          ) : isConnecting ? (
            <div className="flex items-center gap-2 bg-slate-950/90 px-3 py-1 rounded-lg border border-cyan-500/40 text-[11px] text-cyan-300 font-mono">
              <RefreshCw className="w-3 h-3 animate-spin text-cyan-400" />
              <span>Bağlantı Kuruluyor...</span>
            </div>
          ) : (
            <div className="hidden xl:flex items-center gap-2 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800 text-[11px] text-slate-400 font-mono">
              <span className="w-2 h-2 rounded-full bg-cyan-400"></span> Gateway: <span className="text-cyan-300">127.0.0.1:3001</span>
            </div>
          )}

          {/* Quick Setup Modal Button */}
          <button
            onClick={() => setActiveModal('agentInstall')}
            className="px-3 py-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 text-xs font-semibold flex items-center gap-1.5 transition shadow-[0_0_12px_rgba(56,189,248,0.1)]"
          >
            <Download className="w-3.5 h-3.5" /> Agent Script
          </button>

          {/* ELECTRON NATIVE TITLEBAR WINDOW CONTROLS */}
          {typeof window !== 'undefined' && window.electronAPI && (
            <div className="flex items-center gap-1 pl-2 border-l border-slate-800">
              <button
                onClick={() => window.electronAPI.minimizeWindow()}
                className="w-7 h-7 rounded hover:bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center text-xs transition"
                title="Küçült"
              >
                ─
              </button>
              <button
                onClick={() => window.electronAPI.maximizeWindow()}
                className="w-7 h-7 rounded hover:bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center text-xs transition"
                title="Büyüt"
              >
                ▢
              </button>
              <button
                onClick={() => window.electronAPI.closeWindow()}
                className="w-7 h-7 rounded hover:bg-rose-600 text-slate-400 hover:text-white flex items-center justify-center text-xs transition"
                title="Kapat"
              >
                ✕
              </button>
            </div>
          )}
        </div>
      </header>

      {/* ─────────────────────────────────────────────────────────────
          MAIN CONTENT WORKSPACE
      ───────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden relative bg-[#060911]">
        
        {/* =========================================================================
            TAB 1: LIVE CONSOLE (REMOTE DESKTOP STREAM)
        ========================================================================= */}
        {activeTab === 'console' && (
          <div className="flex-1 flex flex-col h-full w-full relative overflow-hidden bg-black">
            
            {/* FLOATING HUD / LIVE CONTROL BAR (ONLY WHEN CONNECTED) */}
            {isConnected && (
              <div className="absolute top-2.5 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 bg-slate-900/95 backdrop-blur-xl px-2.5 py-1.5 rounded-2xl border border-slate-700/80 shadow-[0_8px_32px_rgba(0,0,0,0.6)]">
                
                {/* UAC APPROVE BUTTON */}
                <button
                  onClick={() => sendSpecialKey('UAC_YES')}
                  className="px-2.5 py-1 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold flex items-center gap-1 shadow-[0_0_12px_rgba(16,185,129,0.35)] transition"
                  title="UAC Yönetici İznini Onayla (Evet / Yes)"
                >
                  <Check className="w-3.5 h-3.5 stroke-[3]" /> UAC (Evet)
                </button>

                {/* DISMISS LOCK / UNLOCK BUTTON */}
                <button
                  onClick={() => sendSpecialKey('UNLOCK')}
                  className="px-2.5 py-1 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-bold flex items-center gap-1 shadow-[0_0_12px_rgba(245,158,11,0.35)] transition"
                  title="Kilit Ekranını Aç / Geç (Enter & CAD)"
                >
                  <Unlock className="w-3.5 h-3.5 stroke-[2.5]" /> Kilidi Aç
                </button>

                {/* SPECIAL KEYS DROPDOWN */}
                <div className="relative">
                  <button
                    onClick={() => setSendKeysOpen(!sendKeysOpen)}
                    className="px-2.5 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-[11px] flex items-center gap-1 border border-slate-700 font-semibold text-slate-200 hover:border-slate-600 transition"
                  >
                    <Key className="w-3.5 h-3.5 text-amber-400" /> Tuşlar <ChevronDown className="w-3 h-3 text-slate-400" />
                  </button>
                  {sendKeysOpen && (
                    <div className="absolute left-0 top-full mt-2 flex flex-col bg-slate-950 border border-slate-800 rounded-xl shadow-2xl py-1.5 z-50 min-w-[240px] backdrop-blur-lg">
                      <div className="px-3 py-1 text-[10px] text-slate-500 uppercase tracking-wider font-bold">UAC & Güvenlik</div>
                      <button onClick={() => sendSpecialKey('UAC_YES')} className="px-3 py-1.5 text-xs text-left hover:bg-slate-900 text-emerald-400 font-bold flex items-center gap-2">
                        <Check className="w-3.5 h-3.5 text-emerald-400" /> UAC Onayla — Evet (Enter)
                      </button>
                      <button onClick={() => sendSpecialKey('UAC_NO')} className="px-3 py-1.5 text-xs text-left hover:bg-slate-900 text-rose-400 font-bold flex items-center gap-2">
                        <X className="w-3.5 h-3.5 text-rose-400" /> UAC Reddet — Hayır (Esc)
                      </button>
                      <div className="h-px bg-slate-800 my-1"></div>
                      <div className="px-3 py-1 text-[10px] text-slate-500 uppercase tracking-wider font-bold">Windows Yönetim Tuşları</div>
                      <button onClick={() => sendSpecialKey('CAD')} className="px-3 py-1.5 text-xs text-left hover:bg-slate-900 text-amber-400 flex items-center gap-2">
                        <Key className="w-3.5 h-3.5 text-amber-400" /> Ctrl + Alt + Del
                      </button>
                      <button onClick={() => sendSpecialKey('TASK_MGR')} className="px-3 py-1.5 text-xs text-left hover:bg-slate-900 text-purple-400 flex items-center gap-2">
                        <Cpu className="w-3.5 h-3.5 text-purple-400" /> Görev Yöneticisi (Ctrl+Shift+Esc)
                      </button>
                      <button onClick={() => sendSpecialKey('WIN_KEY')} className="px-3 py-1.5 text-xs text-left hover:bg-slate-900 text-sky-400 flex items-center gap-2">
                        <Monitor className="w-3.5 h-3.5 text-sky-400" /> Başlat Menüsü (Win)
                      </button>
                      <button onClick={() => sendSpecialKey('WIN_L')} className="px-3 py-1.5 text-xs text-left hover:bg-slate-900 text-slate-300 flex items-center gap-2">
                        <Lock className="w-3.5 h-3.5 text-slate-400" /> Oturumu Kilitle (Win+L)
                      </button>
                      <button onClick={() => sendSpecialKey('ALT_F4')} className="px-3 py-1.5 text-xs text-left hover:bg-slate-900 text-rose-400 flex items-center gap-2">
                        <X className="w-3.5 h-3.5 text-rose-400" /> Pencereyi Kapat (Alt+F4)
                      </button>
                      <button onClick={() => sendSpecialKey('PRTSCN')} className="px-3 py-1.5 text-xs text-left hover:bg-slate-900 text-emerald-400 flex items-center gap-2">
                        <Camera className="w-3.5 h-3.5 text-emerald-400" /> Print Screen (Ekran Alıntısı)
                      </button>
                    </div>
                  )}
                </div>

                {/* POWER MANAGEMENT DROPDOWN */}
                <div className="relative">
                  <button
                    onClick={() => setIsPowerMenuOpen(!isPowerMenuOpen)}
                    className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-rose-400 transition"
                    title="Uzaktan Güç Menüsü (Kapat, Yeniden Başlat, Uyku, Uyandır)"
                  >
                    <Power className="w-3.5 h-3.5" />
                  </button>

                  {isPowerMenuOpen && (
                    <div className="absolute top-full right-0 mt-2 w-56 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-1.5 z-50 flex flex-col gap-1 text-xs backdrop-blur-md">
                      <div className="px-2.5 py-1 text-[10px] font-mono text-slate-400 uppercase tracking-wider border-b border-slate-800">
                        Uzaktan Güç Menüsü
                      </div>

                      <button
                        onClick={() => triggerWakeOnLan(targetMac, targetHost)}
                        className="px-2.5 py-2 rounded-lg hover:bg-cyan-500/10 text-cyan-400 font-semibold flex items-center gap-2 transition text-left"
                      >
                        <Zap className="w-3.5 h-3.5" />
                        <span>PC'yi Aç / Uyandır (WoL)</span>
                      </button>

                      <button
                        onClick={() => sendPowerAction('lock')}
                        className="px-2.5 py-2 rounded-lg hover:bg-slate-800 text-slate-200 flex items-center gap-2 transition text-left"
                      >
                        <Lock className="w-3.5 h-3.5 text-amber-400" />
                        <span>Oturumu Kilitle</span>
                      </button>

                      <button
                        onClick={() => sendPowerAction('sleep')}
                        className="px-2.5 py-2 rounded-lg hover:bg-slate-800 text-slate-200 flex items-center gap-2 transition text-left"
                      >
                        <Moon className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Uyku Modu (Sleep)</span>
                      </button>

                      <button
                        onClick={() => sendPowerAction('reboot')}
                        className="px-2.5 py-2 rounded-lg hover:bg-amber-500/10 text-amber-300 font-semibold flex items-center gap-2 transition text-left"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Yeniden Başlat (Restart)</span>
                      </button>

                      <button
                        onClick={() => sendPowerAction('shutdown')}
                        className="px-2.5 py-2 rounded-lg hover:bg-rose-500/10 text-rose-400 font-bold flex items-center gap-2 transition text-left"
                      >
                        <Power className="w-3.5 h-3.5" />
                        <span>Bilgisayarı Kapat (Shutdown)</span>
                      </button>

                      <button
                        onClick={() => sendPowerAction('abort')}
                        className="px-2.5 py-1.5 rounded-lg hover:bg-slate-800 text-slate-400 text-[11px] flex items-center gap-2 transition text-left border-t border-slate-800/80 mt-1"
                      >
                        <X className="w-3 h-3" />
                        <span>Kapatmayı İptal Et</span>
                      </button>
                    </div>
                  )}
                </div>

                <div className="h-4 w-px bg-slate-800 mx-0.5"></div>

                {/* AUDIO / VOICE INTERCOM & CHIME */}
                <button
                  onClick={toggleVoiceIntercom}
                  className={`px-2.5 py-1 rounded-xl border text-[11px] font-bold flex items-center gap-1 transition ${
                    isVoiceActive
                      ? 'bg-rose-500/20 text-rose-400 border-rose-500/50 shadow-[0_0_12px_rgba(244,63,94,0.3)] animate-pulse'
                      : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700 hover:text-white'
                  }`}
                  title={isVoiceActive ? 'Canlı Ses İletimini Kapat' : 'Canlı Ses / Telsiz Aç (Mikrofon ile Karşıya Konuş)'}
                >
                  {isVoiceActive ? <Mic className="w-3.5 h-3.5 text-rose-400 animate-bounce" /> : <MicOff className="w-3.5 h-3.5 text-slate-400" />}
                  <span>{isVoiceActive ? 'Ses Açık' : 'Konuş'}</span>
                </button>

                <button
                  onClick={sendAudioBeep}
                  className="p-1.5 rounded-xl bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-amber-400 transition"
                  title="Karşı Bilgisayarda Dikkat Zili Çal (Windows Chime)"
                >
                  <Bell className="w-3.5 h-3.5" />
                </button>

                <div className="h-4 w-px bg-slate-800 mx-0.5"></div>

                {/* MULTI-MONITOR SELECTOR */}
                {monitors.length > 0 && (
                  <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1 rounded-xl border border-cyan-500/30 text-[10px] font-mono shadow-[0_0_10px_rgba(56,189,248,0.1)]">
                    <Monitor className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                    <select
                      value={selectedMonitorIndex}
                      onChange={(e) => changeMonitor(e.target.value)}
                      className="bg-transparent text-cyan-300 font-bold outline-none cursor-pointer"
                      title="Monitör Seç (Tüm Ekranlar veya Belirli Bir Monitör)"
                    >
                      <option value="ALL" className="bg-slate-900 text-slate-200">
                        Tüm Ekranlar ({monitors.length} Monitör)
                      </option>
                      {monitors.map((m) => (
                        <option key={m.index} value={m.index} className="bg-slate-900 text-slate-200">
                          {m.name || `Monitör ${m.index + 1} (${m.width}x${m.height})`}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* STREAM QUALITY SELECTOR */}
                <div className="flex items-center gap-1 bg-slate-950 px-2 py-1 rounded-xl border border-slate-800 text-[10px] font-mono">
                  <span className="text-slate-400">Kalite:</span>
                  <select
                    value={streamQuality}
                    onChange={(e) => changeStreamQuality(Number(e.target.value))}
                    className="bg-transparent text-indigo-300 font-bold outline-none cursor-pointer"
                    title="Yayın Kalitesi"
                  >
                    <option value={95} className="bg-slate-900 text-slate-200">Ultra (95%)</option>
                    <option value={88} className="bg-slate-900 text-slate-200">Yüksek (88%)</option>
                    <option value={75} className="bg-slate-900 text-slate-200">Dengeli (75%)</option>
                    <option value={55} className="bg-slate-900 text-slate-200">Hızlı / Düşük Ağ (55%)</option>
                  </select>
                </div>

                <div className="h-4 w-px bg-slate-800 mx-0.5"></div>

                {/* AUTO MAX FPS & ULTRA HD LIVE STATUS BADGE */}
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-950 border border-emerald-500/30 text-[10px] font-mono shadow-[0_0_10px_rgba(16,185,129,0.1)]">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 pulse-dot"></span>
                  <span className="text-emerald-400 font-bold">{fps} FPS</span>
                  <span className="text-slate-600">•</span>
                  <span className="text-cyan-400 font-semibold">{latency}ms</span>
                </div>


                <div className="h-4 w-px bg-slate-800 mx-0.5"></div>

                {/* DISPLAY SCALING (FIT / 100%) */}
                <div className="flex bg-slate-950 p-0.5 rounded-xl border border-slate-800">
                  {['fit', '100%'].map(mode => (
                    <button
                      key={mode}
                      onClick={() => setScaleMode(mode)}
                      className={`px-2 py-0.5 rounded-lg text-[10px] font-mono uppercase transition ${
                        scaleMode === mode ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>

                {/* VIEW ONLY / CONTROL MODE */}
                <button
                  onClick={() => setIsViewOnly(!isViewOnly)}
                  className={`px-2 py-1 rounded-xl border text-[10px] font-mono font-bold transition ${
                    isViewOnly
                      ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                      : 'bg-slate-950 text-cyan-400 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  {isViewOnly ? 'İzle' : 'Kontrol'}
                </button>

                {/* INPUT LOCK TOGGLE */}
                <button
                  onClick={toggleLockInput}
                  className={`p-1.5 rounded-xl border text-xs transition ${
                    isInputLocked
                      ? 'bg-amber-500/20 text-amber-400 border-amber-500/50 shadow-[0_0_10px_rgba(245,158,11,0.2)]'
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                  }`}
                  title={isInputLocked ? 'Karşı Kullanıcı Girişini Aç' : 'Karşı Fiziksel Klavye/Fareyi Kilitle'}
                >
                  {isInputLocked ? <Unlock className="w-3.5 h-3.5 text-amber-400" /> : <Lock className="w-3.5 h-3.5" />}
                </button>

                {/* BLACKOUT SCREEN TOGGLE */}
                <button
                  onClick={toggleBlackoutScreen}
                  className={`p-1.5 rounded-xl border text-xs transition ${
                    isScreenBlackedOut
                      ? 'bg-rose-500/20 text-rose-400 border-rose-500/50 shadow-[0_0_10px_rgba(244,63,94,0.2)]'
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                  }`}
                  title={isScreenBlackedOut ? 'Karşı Ekran Görüntüsünü Geri Getir' : 'Karşı Ekranı Karart'}
                >
                  {isScreenBlackedOut ? <EyeOff className="w-3.5 h-3.5 text-rose-400" /> : <Eye className="w-3.5 h-3.5" />}
                </button>

                {/* LIVE CHAT OVERLAY TOGGLE */}
                <button
                  onClick={() => {
                    const next = !(isConsoleDrawerOpen && consoleDrawerTab === 'chat');
                    setIsConsoleDrawerOpen(next);
                    setConsoleDrawerTab('chat');
                    if (next && socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
                      socketRef.current.send(JSON.stringify({ type: 'CHAT_OPEN' }));
                    }
                  }}
                  className={`px-2.5 py-1 rounded-xl text-[11px] font-bold flex items-center gap-1.5 transition ${
                    isConsoleDrawerOpen && consoleDrawerTab === 'chat'
                      ? 'bg-cyan-500 text-slate-950 shadow-[0_0_12px_rgba(6,182,212,0.5)]'
                      : 'bg-slate-800 text-slate-200 border border-slate-700 hover:bg-slate-700 hover:text-cyan-400'
                  }`}
                  title="Karşı Tarafla Canlı Sohbet Penceresini Aç"
                >
                  <MessageSquare className="w-3.5 h-3.5" /> Sohbet
                </button>

                {/* SIDEBAR DRAWER TOGGLE (SÜREÇLER) */}
                <button
                  onClick={() => {
                    const next = !(isConsoleDrawerOpen && consoleDrawerTab === 'processes');
                    setIsConsoleDrawerOpen(next);
                    setConsoleDrawerTab('processes');
                  }}
                  className={`p-1.5 rounded-xl border text-xs transition ${
                    isConsoleDrawerOpen && consoleDrawerTab === 'processes'
                      ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/40'
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                  }`}
                  title="Operasyon Paneli (Süreçler / Görev Yöneticisi)"
                >
                  <Sliders className="w-3.5 h-3.5" />
                </button>

                {/* DISCONNECT BUTTON */}
                <button
                  onClick={handleDisconnect}
                  className="p-1.5 rounded-xl bg-rose-600/20 hover:bg-rose-600 text-rose-400 hover:text-white border border-rose-500/30 transition"
                  title="Bağlantıyı Kapat"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* CANVAS DISPLAY AREA */}
            <div className="flex-1 relative flex items-center justify-center overflow-hidden w-full h-full">
              {isConnected ? (
                <div
                  ref={canvasRef}
                  tabIndex={0}
                  data-remote-canvas="true"
                  className="relative w-full h-full overflow-hidden cursor-crosshair outline-none flex items-center justify-center bg-black"
                  onMouseDown={handleMouseDown}
                  onMouseUp={handleMouseUp}
                  onMouseMove={handleMouseMove}
                  onWheel={(e) => { e.preventDefault(); sendScrollInput(e); }}
                  onContextMenu={(e) => { e.preventDefault(); sendMouseInput('click', e); }}
                >
                  <img
                    ref={screenImgRef}
                    alt="Remote Console Stream"
                    className={`w-full h-full pointer-events-none select-none ${
                      !hasFrame ? 'opacity-0' : 'opacity-100'
                    } ${
                      scaleMode === 'fit'
                        ? 'object-contain'
                        : scaleMode === 'stretch'
                        ? 'object-fill'
                        : 'object-none'
                    }`}
                    style={{
                      imageRendering: 'auto',
                      transform: 'translateZ(0)',
                      backfaceVisibility: 'hidden'
                    }}
                  />
                  {!hasFrame && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 gap-3 p-6 text-center max-w-md">
                      <RefreshCw className="w-9 h-9 animate-spin text-cyan-400" />
                      <span className="text-sm font-bold text-slate-100 tracking-wide">
                        {deployStatus ? 'Otomatik Kurulum / Güncelleme Devam Ediyor' : 'Bağlantı Kuruluyor...'}
                      </span>
                      {deployStatus ? (
                        <div className="text-xs font-mono text-cyan-300 bg-cyan-950/70 border border-cyan-500/40 px-4 py-2.5 rounded-xl shadow-lg w-full animate-pulse">
                          {deployStatus}
                        </div>
                      ) : (
                        <span className="text-xs font-mono text-cyan-300 tracking-wider">YÜKSEK ÇÖZÜNÜRLÜKLÜ AKIŞ BAŞLATILIYOR...</span>
                      )}
                    </div>
                  )}

                  {isInputLocked && (
                    <div className="absolute top-16 left-6 bg-amber-500/90 text-slate-950 px-3 py-1 rounded-lg font-bold text-xs flex items-center gap-1.5 shadow-xl animate-pulse z-30">
                      <Lock className="w-3.5 h-3.5" /> KARŞI FİZİKSEL KLAVYE VE FARE KİLİTLİ
                    </div>
                  )}

                  {isScreenBlackedOut && (
                    <div className="absolute top-16 right-6 bg-slate-950/90 border border-rose-500/50 text-rose-300 px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-3 shadow-2xl backdrop-blur-md z-30 animate-pulse">
                      <div className="flex items-center gap-2">
                        <EyeOff className="w-4 h-4 text-rose-400" />
                        <span>Karşı Monitör Karartıldı (Gizli Mod)</span>
                      </div>
                      <button
                        onClick={toggleBlackoutScreen}
                        className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-bold transition shadow pointer-events-auto"
                      >
                        Geri Aç
                      </button>
                    </div>
                  )}
                </div>
              ) : connectionError ? (
                /* ERROR PANEL */
                <div className="flex flex-col items-center justify-center p-8 max-w-lg glass-card rounded-2xl text-center border-rose-500/30 shadow-[0_0_30px_rgba(244,63,94,0.15)]">
                  <div className="w-14 h-14 rounded-full bg-rose-500/10 border border-rose-500/30 flex items-center justify-center mb-4 text-rose-400">
                    <AlertCircle className="w-7 h-7" />
                  </div>
                  <div className="text-[11px] font-mono px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 font-bold mb-2">
                    {connectionError.code}
                  </div>
                  <h3 className="text-base font-bold text-slate-100">Bağlantı Kurulamadı</h3>
                  <p className="text-xs text-slate-300 mt-2 leading-relaxed">
                    {connectionError.message}
                  </p>
                  <div className="mt-4 p-3 bg-slate-950 rounded-xl border border-slate-800 text-left text-[11px] text-slate-400 space-y-1 w-full font-mono">
                    <div className="text-slate-300 font-bold mb-1">Sorun Giderme Adımları:</div>
                    <div>1. Hedef makinede <strong className="text-cyan-400">RemoteMM_Agent.exe</strong> çalışıyor mu?</div>
                    <div>2. Güvenlik Duvarı <strong className="text-amber-400">6129</strong> portuna izin veriyor mu?</div>
                    <div>3. IP Adresi (<strong className="text-emerald-400">{targetHost}</strong>) doğru mu?</div>
                  </div>
                  <div className="flex items-center gap-3 mt-5 w-full">
                    <button
                      onClick={() => handleConnect()}
                      className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-500 hover:to-rose-400 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-rose-600/30 transition"
                    >
                      <RefreshCw className="w-4 h-4" /> Yeniden Dene
                    </button>
                    <button
                      onClick={() => handleConnect(null, { forceReinstall: true })}
                      className="flex-1 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-cyan-600/30 transition"
                      title="Silinmiş veya bozuk agent'ı temizleyip sıfırdan kurar ve bağlar"
                    >
                      <Download className="w-4 h-4" /> Sıfırdan Kur & Bağlan
                    </button>
                  </div>
                </div>
              ) : (
                /* DISCONNECTED LAUNCHER VIEW */
                <div className="w-full h-full flex items-center justify-center bg-grid-pattern p-6">
                  <div className="max-w-4xl w-full grid grid-cols-1 md:grid-cols-2 gap-6">
                    
                    {/* QUICK CONNECT CARD */}
                    <div className="glass-card rounded-2xl p-6 border-cyan-500/30 shadow-[0_0_25px_rgba(56,189,248,0.08)] flex flex-col justify-between">
                      <div>
                        <div className="flex items-center gap-2.5 mb-4">
                          <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
                            <Zap className="w-5 h-5 text-cyan-400" />
                          </div>
                          <div>
                            <h2 className="text-sm font-bold text-slate-100">Hızlı Uzak Bağlantı Başlat</h2>
                            <p className="text-xs text-slate-400">Hedef makinenin IP veya hostname adresini girin</p>
                          </div>
                        </div>

                        <div className="space-y-3 text-xs">
                          <div>
                            <label className="text-[11px] font-semibold text-slate-300">Hedef IP / Bilgisayar Adı:</label>
                            <input
                              type="text"
                              value={targetHost}
                              onChange={(e) => setTargetHost(e.target.value)}
                              className="w-full mt-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl focus:border-cyan-500 outline-none font-mono text-slate-100"
                              placeholder="Örn: 172.31.132.183 veya MAKINE1"
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-[11px] font-semibold text-slate-400">Port:</label>
                              <input
                                type="text"
                                value={targetPort}
                                onChange={(e) => setTargetPort(e.target.value)}
                                className="w-full mt-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl outline-none font-mono text-slate-100"
                              />
                            </div>
                            <div>
                              <label className="text-[11px] font-semibold text-slate-400">Domain / Çalışma Grubu:</label>
                              <input
                                type="text"
                                value={authDomain}
                                onChange={(e) => setAuthDomain(e.target.value)}
                                className="w-full mt-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl outline-none font-mono text-slate-100"
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-[11px] font-semibold text-slate-400">Yönetici Kullanıcı:</label>
                              <input
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                className="w-full mt-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl outline-none text-slate-100"
                              />
                            </div>
                            <div>
                              <label className="text-[11px] font-semibold text-slate-400">Şifre:</label>
                              <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full mt-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl outline-none text-slate-100"
                                placeholder="••••••••"
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="pt-5 space-y-2">
                        <button
                          disabled={isConnecting || !targetHost.trim()}
                          onClick={() => handleConnect()}
                          className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-600 via-sky-500 to-indigo-600 hover:opacity-95 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(56,189,248,0.25)] transition disabled:opacity-50"
                        >
                          {isConnecting ? (
                            <><RefreshCw className="w-4 h-4 animate-spin" /> Bağlantı Kuruluyor...</>
                          ) : (
                            <><Play className="w-4 h-4 fill-current" /> Konsolu Başlat (Canlı Bağlan)</>
                          )}
                        </button>
                        <button
                          disabled={isConnecting || !targetHost.trim()}
                          onClick={() => handleConnect(null, { forceReinstall: true })}
                          className="w-full py-2.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800/80 font-semibold text-[11px] flex items-center justify-center gap-2 transition disabled:opacity-50"
                          title="Silinmiş veya eski sürüm agent durumunda sıfırdan kurup başlatır"
                        >
                          <Download className="w-3.5 h-3.5 text-cyan-400" />
                          <span>Zorla Yeniden Yükle / Güncelle & Bağlan</span>
                        </button>
                      </div>
                    </div>

                    {/* FLEET QUICK LAUNCHER CARD */}
                    <div className="glass-card rounded-2xl p-6 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-2">
                            <Server className="w-5 h-5 text-indigo-400" />
                            <h2 className="text-sm font-bold text-slate-100">Kayıtlı Sunucular (Fleet)</h2>
                          </div>
                          <button
                            onClick={() => setActiveTab('fleet')}
                            className="text-xs text-cyan-400 hover:underline flex items-center gap-1 font-semibold"
                          >
                            Filoyu Aç <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="space-y-2.5 overflow-y-auto max-h-[220px] pr-1">
                          {allHosts.map((h, idx) => (
                            <div
                              key={`launcher-${h.id || 'host'}-${idx}`}
                              className="p-3 rounded-xl bg-slate-950/80 border border-slate-800/80 hover:border-cyan-500/40 flex items-center justify-between transition group"
                            >
                              <div className="flex items-center gap-3">
                                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 pulse-dot"></span>
                                <div>
                                  <div className="text-xs font-bold text-slate-200 group-hover:text-cyan-300 transition">
                                    {h.name}
                                  </div>
                                  <div className="text-[11px] font-mono text-slate-500">
                                    {h.ip}:{h.port} • {h.user}
                                  </div>
                                </div>
                              </div>
                              <button
                                onClick={() => handleConnect(h)}
                                className="px-3 py-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 text-xs font-bold flex items-center gap-1.5 transition"
                              >
                                <Zap className="w-3 h-3 fill-current" /> 1-Click
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* QUICK SCRIPT BANNER */}
                      <div className="mt-4 p-3 rounded-xl bg-slate-950 border border-slate-800/80 flex items-center justify-between text-xs font-mono">
                        <span className="text-slate-400 truncate max-w-[240px]">
                          C:\RemoteMM\RemoteMM_Agent.exe (SYSTEM)
                        </span>
                        <button
                          onClick={() => copyToClipboard(setupCommand)}
                          className="text-cyan-400 hover:text-cyan-300 font-bold flex items-center gap-1"
                        >
                          <Copy className="w-3.5 h-3.5" /> {copiedCode ? 'Kopyalandı!' : 'Kodu Al'}
                        </button>
                      </div>
                    </div>

                  </div>
                </div>
              )}
            </div>

            {/* FLOATING OVERLAY PANEL (CHAT & PROCESSES DURING LIVE STREAM - ZERO CANVAS SHRINK) */}
            {isConnected && isConsoleDrawerOpen && (
              <div
                data-chat-panel="true"
                onMouseDown={(e) => e.stopPropagation()}
                onMouseUp={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                className="absolute right-6 bottom-6 w-96 h-[500px] max-h-[80vh] bg-slate-950/95 backdrop-blur-2xl border border-cyan-500/30 rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.85)] flex flex-col z-50 overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200"
              >
                <div className="h-11 px-3.5 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between text-xs font-semibold select-none">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => {
                        setConsoleDrawerTab('chat');
                        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
                          socketRef.current.send(JSON.stringify({ type: 'CHAT_OPEN' }));
                        }
                      }}
                      className={`px-3 py-1 rounded-lg font-bold flex items-center gap-1.5 transition ${
                        consoleDrawerTab === 'chat'
                          ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <MessageSquare className="w-3.5 h-3.5" /> Sohbet
                    </button>
                    <button
                      onClick={() => setConsoleDrawerTab('processes')}
                      className={`px-3 py-1 rounded-lg font-bold flex items-center gap-1.5 transition ${
                        consoleDrawerTab === 'processes'
                          ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Cpu className="w-3.5 h-3.5" /> Süreçler
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 pulse-dot" title="Canlı İletişim Aktif"></span>
                    <button
                      onClick={() => setIsConsoleDrawerOpen(false)}
                      className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                      title="Kapat"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {consoleDrawerTab === 'chat' ? (
                  <div className="flex-1 flex flex-col p-3 text-xs overflow-hidden bg-slate-950/50">
                    <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 mb-2">
                      {chatMessages.map((msg, i) => {
                        const isTech = msg.sender.includes('You') || msg.sender.includes('Technician') || msg.sender.includes('Teknisyen');
                        const isSys = msg.sender.includes('System') || msg.sender.includes('Sistem');
                        return (
                          <div
                            key={i}
                            className={`p-2.5 rounded-xl border max-w-[88%] text-xs shadow-sm ${
                              isTech
                                ? 'ml-auto bg-gradient-to-r from-cyan-950/80 to-sky-950/80 border-cyan-500/40 text-cyan-100 rounded-tr-none'
                                : isSys
                                ? 'mx-auto bg-slate-900/60 border-slate-800/80 text-slate-400 text-[11px] text-center w-full'
                                : 'mr-auto bg-emerald-950/70 border-emerald-500/40 text-emerald-100 rounded-tl-none'
                            }`}
                          >
                            <div className="flex justify-between items-center text-[10px] opacity-75 font-mono mb-1 gap-3">
                              <span className="font-bold">{msg.sender}</span>
                              <span className="text-slate-400 text-[9px]">{msg.time}</span>
                            </div>
                            <div className="text-slate-100 font-sans leading-relaxed break-words">{msg.text}</div>
                          </div>
                        );
                      })}
                      <div ref={chatEndRef} />
                    </div>
                    <form onSubmit={handleSendChat} className="flex gap-2 pt-1 border-t border-slate-800/80">
                      <input
                        type="text"
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        placeholder="Karşı kullanıcıya mesaj ilet..."
                        className="flex-1 bg-slate-900/90 border border-slate-800 rounded-xl px-3 py-2 outline-none text-slate-100 text-xs focus:border-cyan-500 transition"
                      />
                      <button
                        type="submit"
                        className="px-3.5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold flex items-center justify-center transition shadow-lg shadow-cyan-600/30"
                        title="Gönder"
                      >
                        <Send className="w-3.5 h-3.5" />
                      </button>
                    </form>
                  </div>
                ) : (
                  <div className="flex-1 p-3 text-xs overflow-y-auto space-y-2 bg-slate-950/50">
                    <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Aktif Süreçler</div>
                    {processes.map(p => (
                      <div key={p.Id} className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800/80 flex items-center justify-between hover:border-slate-700 transition">
                        <div>
                          <div className="font-bold text-slate-200">{p.ProcessName}</div>
                          <div className="text-[10px] text-slate-400 font-mono">PID: {p.Id} • {p.CPU}</div>
                        </div>
                        <button
                          onClick={() => handleKillProcess(p.Id)}
                          className="px-2.5 py-1 rounded-lg bg-rose-500/20 text-rose-400 hover:bg-rose-500/30 text-[10px] font-semibold transition"
                        >
                          Sonlandır
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

          </div>
        )}

        {/* =========================================================================
            TAB 2: SERVER FLEET & NOC GRID (DATACENTER OVERVIEW)
        ========================================================================= */}
        {activeTab === 'fleet' && (
          <div className="flex-1 flex flex-col overflow-y-auto p-6 bg-grid-pattern">
            
            {/* NOC METRICS STATS BAR */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <div className="glass-card rounded-2xl p-4 border-cyan-500/20">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-400">Yönetilen Sunucular</span>
                  <Server className="w-4 h-4 text-cyan-400" />
                </div>
                <div className="text-2xl font-black font-mono text-slate-100 mt-2">{allHosts.length}</div>
                <div className="text-[10px] text-cyan-400 mt-1 font-mono flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span> Toplam Envanter Düğümü
                </div>
              </div>

              <div className="glass-card rounded-2xl p-4 border-emerald-500/20">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-400">Canlı Sistem Durumu</span>
                  <Activity className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="text-2xl font-black font-mono text-emerald-400 mt-2">
                  {allHosts.length > 0 ? `${onlineCount} / ${allHosts.length} ONLINE` : '0 ONLINE'}
                </div>
                <div className="text-[10px] text-emerald-400 mt-1 font-mono flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 pulse-dot"></span>
                  {offlineCount > 0 ? `${offlineCount} düğüm kapalı / uyku modunda` : 'Tüm düğümler aktif ve erişilebilir'}
                </div>
              </div>

              <div className="glass-card rounded-2xl p-4 border-indigo-500/20">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-400">Canlı Önizleme Modu</span>
                  <Eye className="w-4 h-4 text-indigo-400" />
                </div>
                <div className="text-2xl font-black font-mono text-indigo-300 mt-2">
                  {isLivePreviewEnabled ? 'CANLI AKTİF' : 'DEVRE DIŞI'}
                </div>
                <div className="text-[10px] text-indigo-400 mt-1 font-mono">
                  {isLivePreviewEnabled ? '3s Canlı Akış & Otomatik İzleme' : 'Bant Genişliği Tasarrufu'}
                </div>
              </div>

              <div className="glass-card rounded-2xl p-4 border-amber-500/20">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-400">Hızlı Dağıtım Portu</span>
                  <Zap className="w-4 h-4 text-amber-400" />
                </div>
                <div className="text-2xl font-black font-mono text-amber-400 mt-2">GATEWAY 3001</div>
                <div className="text-[10px] text-slate-400 mt-1 font-mono">TCP 6129 • WoL UDP 7,9 Hazır</div>
              </div>
            </div>

            {/* FILTER & SEARCH TOOLBAR */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mb-6 bg-slate-950/70 p-3 rounded-2xl border border-slate-800">
              <div className="flex items-center gap-3 w-full sm:w-auto">
                <div className="relative flex-1 sm:w-72">
                  <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    placeholder="Sunucu adı, IP veya kullanıcı ara..."
                    className="w-full pl-9 pr-3 py-1.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-200 outline-none focus:border-cyan-500"
                  />
                </div>

                <div className="flex gap-1.5">
                  {['ALL', 'WORKGROUP'].map(grp => (
                    <button
                      key={grp}
                      onClick={() => setSelectedGroup(grp)}
                      className={`px-3 py-1 rounded-xl text-[11px] font-semibold transition ${
                        selectedGroup === grp
                          ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                          : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {grp}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                {/* Live Preview Toggle */}
                <button
                  onClick={() => setIsLivePreviewEnabled(!isLivePreviewEnabled)}
                  className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition ${
                    isLivePreviewEnabled
                      ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 shadow-[0_0_10px_rgba(99,102,241,0.2)]'
                      : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200'
                  }`}
                  title="Canlı Ekran Önizleme Küçük Resimlerini Aç / Kapat"
                >
                  {isLivePreviewEnabled ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  <span>{isLivePreviewEnabled ? 'Canlı Ekran: Açık' : 'Ekran: Kapalı'}</span>
                </button>

                {/* Manual Refresh Button */}
                <button
                  onClick={() => pollFleetStatus(allHosts, isLivePreviewEnabled)}
                  disabled={isPollingFleet}
                  className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-cyan-500/40 text-slate-300 hover:text-cyan-300 text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-50"
                  title="Tüm Makinelerin Durumunu ve Ekran Görüntülerini Hemen Tara"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isPollingFleet ? 'animate-spin text-cyan-400' : ''}`} />
                  <span>{isPollingFleet ? 'Taranıyor...' : 'Yenile'}</span>
                </button>

                <button
                  onClick={() => setActiveModal('addHost')}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(56,189,248,0.25)] transition"
                >
                  <Plus className="w-4 h-4" /> Yeni Sunucu Ekle
                </button>
              </div>
            </div>

            {/* SERVER FLEET RACK GRID */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredHosts.map((h, idx) => {
                const status = hostStatuses[h.id];
                const isOnline = Boolean(status?.online);
                const snap = hostSnapshots[h.id];
                const regDev = registeredDevices.find(d => d.primaryIp === h.ip || d.hostname?.toLowerCase() === h.name?.toLowerCase());
                const telem = regDev?.telemetry;

                return (

                  <div
                    key={`fleet-${h.id || 'host'}-${idx}`}
                    className={`glass-card rounded-2xl p-5 border border-slate-800 hover:border-cyan-500/50 flex flex-col justify-between group transition-all relative ${
                      openPowerCardId === h.id ? 'z-30 ring-1 ring-rose-500/40 shadow-2xl' : 'z-10'
                    }`}
                  >
                    <div>
                      {/* Server Header */}
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-9 h-9 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-cyan-400 group-hover:border-cyan-500/40 transition">
                            <Server className="w-4 h-4" />
                          </div>
                          <div>
                            <h3 className="font-bold text-sm text-slate-100 group-hover:text-cyan-300 transition">
                              {h.name}
                            </h3>
                            <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400 mt-0.5">
                              <span>{h.ip}</span>
                              <span>•</span>
                              <span className="text-cyan-400 font-semibold">{h.domain}</span>
                            </div>
                          </div>
                        </div>

                        {/* Real-Time Status Badge */}
                        {isOnline ? (
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-950/80 text-emerald-400 border border-emerald-800/40 flex items-center gap-1.5 shadow-[0_0_10px_rgba(52,211,153,0.2)]">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 pulse-dot"></span>
                            AÇIK {status?.latency ? `(${status.latency}ms)` : ''}
                          </span>
                        ) : (
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-rose-950/80 text-rose-400 border border-rose-800/40 flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                            KAPALI
                          </span>
                        )}
                      </div>

                      {/* LIVE SCREEN PREVIEW THUMBNAIL (16:9) */}
                      <div className="relative aspect-video w-full rounded-xl overflow-hidden bg-slate-950/90 border border-slate-800/80 my-3 group/thumb shadow-inner flex items-center justify-center">
                        {isOnline && isLivePreviewEnabled && snap?.snapshot ? (
                          <>
                            <img
                              src={snap.snapshot}
                              alt={`${h.name} Canlı Ekran`}
                              className="w-full h-full object-cover select-none transition-transform duration-300 group-hover/thumb:scale-105"
                            />

                            {/* Top Left: Live indicator badge */}
                            <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/80 backdrop-blur-md border border-white/10 text-[9px] font-mono font-semibold text-emerald-400 flex items-center gap-1 shadow z-30 pointer-events-none select-none">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                              CANLI EKRAN
                            </div>

                            {/* Top Right: Direct Quick Power & Zoom Buttons (z-30 pointer-events-auto ALWAYS CLICKABLE) */}
                            <div className="absolute top-2 right-2 flex items-center gap-1.5 z-30 pointer-events-auto">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setPreviewModalHost(h);
                                }}
                                className="p-1 rounded bg-black/85 hover:bg-black/95 backdrop-blur-md border border-white/20 text-slate-300 hover:text-cyan-300 transition shadow cursor-pointer"
                                title="Ekranı Büyüt ve İncele (Gözetim Modu)"
                              >
                                <Maximize2 className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleRemotePowerAction(h, 'shutdown');
                                }}
                                className="px-1.5 py-0.5 rounded bg-rose-950/90 hover:bg-rose-900 backdrop-blur-md border border-rose-500/50 text-[9px] font-mono font-bold text-rose-300 flex items-center gap-1 transition shadow hover:scale-105 cursor-pointer"
                                title="Bilgisayarı Kapat (Shutdown)"
                              >
                                <Power className="w-2.5 h-2.5 text-rose-400" /> Kapat
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleRemotePowerAction(h, 'reboot');
                                }}
                                className="px-1.5 py-0.5 rounded bg-amber-950/90 hover:bg-amber-900 backdrop-blur-md border border-amber-500/50 text-[9px] font-mono font-bold text-amber-300 flex items-center gap-1 transition shadow hover:scale-105 cursor-pointer"
                                title="Yeniden Başlat (Reboot)"
                              >
                                <RefreshCw className="w-2.5 h-2.5 text-amber-400" /> Reboot
                              </button>
                            </div>

                            {/* Bottom Left: User & Res info */}
                            {snap.user && (
                              <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-black/80 backdrop-blur-md border border-white/10 text-[9px] font-mono text-slate-300 flex items-center gap-1.5 max-w-[60%] truncate shadow z-30 pointer-events-none select-none">
                                <User className="w-2.5 h-2.5 text-cyan-400 shrink-0" />
                                <span className="truncate">{snap.user}</span>
                                {snap.width ? <span className="text-slate-500">• {snap.width}x{snap.height}</span> : null}
                              </div>
                            )}

                            {/* Bottom Right: Manual Snapshot Refresh button */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                pollFleetStatus([h], true);
                              }}
                              className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-black/85 hover:bg-black/95 backdrop-blur-md border border-white/20 text-[9px] font-mono text-cyan-300 flex items-center gap-1 transition shadow hover:scale-105 z-30 pointer-events-auto cursor-pointer"
                              title="Ekranı Yeniden Çek (Snapshot Refresh)"
                            >
                              <Camera className="w-2.5 h-2.5 text-cyan-400" /> Yenile
                            </button>

                            {/* Center Hover Overlay (z-10 pointer-events-none so it NEVER blocks the top/bottom buttons) */}
                            <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-[1px] opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center pointer-events-none z-10">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleConnect(h);
                                }}
                                className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs flex items-center gap-2 shadow-[0_0_20px_rgba(56,189,248,0.5)] transition transform scale-95 group-hover/thumb:scale-100 cursor-pointer pointer-events-auto"
                              >
                                <Monitor className="w-3.5 h-3.5" /> Canlı İzle & Yönet
                              </button>
                            </div>
                          </>
                        ) : isOnline ? (
                          <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center bg-gradient-to-b from-slate-900/60 to-slate-950 relative">
                            {/* Direct Quick Power on Online with no snapshot */}
                            <div className="absolute top-2 right-2 flex items-center gap-1 z-30 pointer-events-auto">
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleRemotePowerAction(h, 'shutdown'); }}
                                className="px-1.5 py-0.5 rounded bg-rose-950/80 hover:bg-rose-900 border border-rose-500/40 text-[9px] font-mono font-bold text-rose-300 flex items-center gap-1 shadow cursor-pointer"
                                title="Bilgisayarı Kapat"
                              >
                                <Power className="w-2.5 h-2.5 text-rose-400" /> Kapat
                              </button>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleRemotePowerAction(h, 'reboot'); }}
                                className="px-1.5 py-0.5 rounded bg-amber-950/80 hover:bg-amber-900 border border-amber-500/40 text-[9px] font-mono font-bold text-amber-300 flex items-center gap-1 shadow cursor-pointer"
                                title="Yeniden Başlat"
                              >
                                <RefreshCw className="w-2.5 h-2.5 text-amber-400" /> Reboot
                              </button>
                            </div>
                            <div className="w-10 h-10 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mb-1.5">
                              <Monitor className="w-5 h-5" />
                            </div>
                            <span className="text-xs font-semibold text-slate-200">Makine Açık (Port 6129 Aktif)</span>
                            <span className="text-[10px] text-cyan-400 font-mono mt-0.5 mb-2.5">Görüntü aktarımı hazır</span>
                            <div className="flex items-center gap-2 z-30">
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); pollFleetStatus([h], true); }}
                                className="px-2.5 py-1 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-300 text-[10px] font-semibold flex items-center gap-1 transition cursor-pointer"
                              >
                                <Camera className="w-3 h-3" /> Ekranı Şimdi Çek
                              </button>
                              <button
                                type="button"
                                onClick={() => handleConnect(h)}
                                className="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 text-[10px] font-semibold flex items-center gap-1 transition cursor-pointer"
                              >
                                <Zap className="w-3 h-3 fill-current" /> Doğrudan Bağlan
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center p-3 text-center bg-gradient-to-b from-slate-950 to-rose-950/20">
                            <div className="w-10 h-10 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 mb-1.5">
                              <Power className="w-5 h-5" />
                            </div>
                            <span className="text-xs font-semibold text-slate-300">Bilgisayar Kapalı / Uykuda</span>
                            <span className="text-[10px] text-slate-500 font-mono mb-2">Ajan Portu (6129) Yanıt Vermiyor</span>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); triggerWakeOnLan(h); }}
                              className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-[11px] font-semibold flex items-center gap-1.5 transition shadow-[0_0_12px_rgba(245,158,11,0.2)] cursor-pointer"
                            >
                              <Zap className="w-3 h-3 fill-current" /> ⚡ Wake-on-LAN ile Aç
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Server Specs & Telemetry Badges */}
                      <div className="grid grid-cols-2 gap-2 my-3 p-2.5 rounded-xl bg-slate-950/90 border border-slate-800/80 text-[11px] font-mono">
                        <div>
                          <span className="text-slate-500 block text-[10px]">İŞLETİM SİSTEMİ</span>
                          <span className="text-slate-300 font-semibold truncate block">{regDev?.osName || h.os || 'Windows 11 Pro'}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block text-[10px]">AJAN / GÜVENLİK</span>
                          <span className={isOnline ? "text-emerald-400 font-semibold" : "text-slate-400 font-semibold"}>
                            {isOnline ? (telem?.isLocked ? '🔒 KİLİTLİ (SYSTEM)' : '🔓 AKTİF (SYSTEM)') : 'OFFLINE'}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block text-[10px]">CPU & RAM</span>
                          {telem ? (
                            <span className="text-cyan-300 font-semibold block truncate">
                              %{telem.cpuPercent} CPU • {telem.usedRamMb ? Math.round(telem.usedRamMb / 1024) : 0} GB
                            </span>
                          ) : (
                            <span className="text-slate-300 font-semibold block truncate">{h.cpu || '8%'} • {h.ram || 'RAM'}</span>
                          )}
                        </div>
                        <div>
                          <span className="text-slate-500 block text-[10px]">DİSK / ÇALIŞMA</span>
                          <span className="text-slate-300 font-semibold truncate block">
                            {telem?.freeDiskGb ? `${telem.freeDiskGb}GB Boş` : 'C: Hazır'} {telem?.uptimeSec ? `• ${Math.floor(telem.uptimeSec / 3600)}sa` : ''}
                          </span>
                        </div>
                      </div>

                    </div>

                    {/* Actions Toolbar */}
                    <div className="flex items-center gap-1.5 pt-3 border-t border-slate-800/80 relative">
                      <button
                        type="button"
                        onClick={() => handleConnect(h)}
                        className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 via-sky-500 to-indigo-600 hover:opacity-90 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-[0_0_15px_rgba(56,189,248,0.2)] transition truncate cursor-pointer"
                      >
                        <Zap className="w-3.5 h-3.5 fill-current shrink-0" /> 1-Click Bağlan
                      </button>

                      {/* POWER MANAGEMENT DROPDOWN BUTTON */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setOpenPowerCardId(openPowerCardId === h.id ? null : h.id);
                          }}
                          className={`p-2.5 rounded-xl border transition flex items-center gap-1 cursor-pointer ${
                            openPowerCardId === h.id
                              ? 'bg-rose-500/25 text-rose-300 border-rose-500/60 shadow-[0_0_12px_rgba(244,63,94,0.4)]'
                              : 'bg-slate-900 hover:bg-rose-500/20 text-slate-300 hover:text-rose-300 border-slate-800'
                          }`}
                          title="Uzaktan Güç ve Sistem İşlemleri (Aç, Kapat, Yeniden Başlat, Kilitle, Uyku)"
                        >
                          <Power className="w-4 h-4 text-rose-400" />
                          <ChevronDown className={`w-3 h-3 transition-transform ${openPowerCardId === h.id ? 'rotate-180' : ''}`} />
                        </button>

                        {/* FLOATING POWER DROPDOWN MENU */}
                        {openPowerCardId === h.id && (
                          <>
                            {/* Backdrop to close when clicking outside */}
                            <div
                              className="fixed inset-0 z-40"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setOpenPowerCardId(null);
                              }}
                            />
                            <div
                              onClick={(e) => e.stopPropagation()}
                              className="absolute bottom-full right-0 mb-2 w-64 rounded-2xl bg-slate-900/98 backdrop-blur-2xl border border-slate-700 shadow-[0_10px_40px_rgba(0,0,0,0.85)] p-2 z-50 animate-in fade-in zoom-in-95 duration-150"
                            >
                              <div className="px-2.5 py-1.5 text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider border-b border-slate-800 mb-1.5 flex items-center justify-between">
                                <span>⚡ GÜÇ YÖNETİMİ</span>
                                <span className={`px-1.5 py-0.5 rounded text-[9px] ${isOnline ? 'bg-emerald-950 text-emerald-400' : 'bg-rose-950 text-rose-400'}`}>
                                  {isOnline ? 'ONLINE' : 'OFFLINE'}
                                </span>
                              </div>

                              {/* Wake-on-LAN */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenPowerCardId(null);
                                  triggerWakeOnLan(h);
                                }}
                                className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-amber-500/15 text-slate-200 hover:text-amber-300 text-xs flex items-center gap-2.5 transition group cursor-pointer"
                              >
                                <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 group-hover:scale-105 transition shrink-0">
                                  <Zap className="w-3.5 h-3.5 fill-current" />
                                </div>
                                <div>
                                  <div className="font-semibold text-slate-200 group-hover:text-amber-300">Bilgisayarı Aç (WoL)</div>
                                  <div className="text-[10px] text-slate-400">Sihirli Paket gönder</div>
                                </div>
                              </button>

                              {/* Shutdown */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenPowerCardId(null);
                                  handleRemotePowerAction(h, 'shutdown');
                                }}
                                className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-rose-500/15 text-slate-200 hover:text-rose-300 text-xs flex items-center gap-2.5 transition group cursor-pointer"
                              >
                                <div className="w-7 h-7 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 group-hover:scale-105 transition shrink-0">
                                  <Power className="w-3.5 h-3.5" />
                                </div>
                                <div>
                                  <div className="font-semibold text-slate-200 group-hover:text-rose-300">Bilgisayarı Kapat</div>
                                  <div className="text-[10px] text-slate-400">Sistemi güvenle kapat (shutdown)</div>
                                </div>
                              </button>

                              {/* Reboot */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenPowerCardId(null);
                                  handleRemotePowerAction(h, 'reboot');
                                }}
                                className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-amber-500/15 text-slate-200 hover:text-amber-300 text-xs flex items-center gap-2.5 transition group cursor-pointer"
                              >
                                <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 group-hover:scale-105 transition shrink-0">
                                  <RefreshCw className="w-3.5 h-3.5" />
                                </div>
                                <div>
                                  <div className="font-semibold text-slate-200 group-hover:text-amber-300">Yeniden Başlat (Reboot)</div>
                                  <div className="text-[10px] text-slate-400">Sistemi yeniden başlat</div>
                                </div>
                              </button>

                              {/* Lock */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenPowerCardId(null);
                                  handleRemotePowerAction(h, 'lock');
                                }}
                                className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-blue-500/15 text-slate-200 hover:text-blue-300 text-xs flex items-center gap-2.5 transition group cursor-pointer"
                              >
                                <div className="w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 group-hover:scale-105 transition shrink-0">
                                  <Lock className="w-3.5 h-3.5" />
                                </div>
                                <div>
                                  <div className="font-semibold text-slate-200 group-hover:text-blue-300">Oturumu Kilitle</div>
                                  <div className="text-[10px] text-slate-400">LockWorkStation</div>
                                </div>
                              </button>

                              {/* Sleep */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenPowerCardId(null);
                                  handleRemotePowerAction(h, 'sleep');
                                }}
                                className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-purple-500/15 text-slate-200 hover:text-purple-300 text-xs flex items-center gap-2.5 transition group cursor-pointer"
                              >
                                <div className="w-7 h-7 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 group-hover:scale-105 transition shrink-0">
                                  <Moon className="w-3.5 h-3.5" />
                                </div>
                                <div>
                                  <div className="font-semibold text-slate-200 group-hover:text-purple-300">Uyku Modu (Sleep)</div>
                                  <div className="text-[10px] text-slate-400">Askıya al</div>
                                </div>
                              </button>

                              {/* Abort */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenPowerCardId(null);
                                  handleRemotePowerAction(h, 'abort');
                                }}
                                className="w-full text-left px-2.5 py-1.5 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-slate-200 text-xs flex items-center gap-2.5 transition border-t border-slate-800/80 mt-1 cursor-pointer"
                              >
                                <div className="w-7 h-7 rounded-lg bg-slate-800 flex items-center justify-center text-slate-400 shrink-0">
                                  <AlertTriangle className="w-3.5 h-3.5" />
                                </div>
                                <div>
                                  <div className="font-semibold">Kapatmayı İptal Et</div>
                                  <div className="text-[10px] text-slate-500">shutdown /a</div>
                                </div>
                              </button>
                            </div>
                          </>
                        )}
                      </div>

                      {/* Reinstall Agent */}
                      <button
                        onClick={() => handleConnect(h, { forceReinstall: true })}
                        className="p-2.5 rounded-xl bg-slate-900 hover:bg-cyan-500/20 text-slate-400 hover:text-cyan-400 border border-slate-800 transition"
                        title="Agent'ı Sıfırdan Kur, Güncelle ve Bağlan"
                      >
                        <Download className="w-4 h-4" />
                      </button>

                      {/* Edit Host */}
                      <button
                        onClick={() => handleOpenEditHost(h)}
                        className="p-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-amber-400 border border-slate-800 transition"
                        title="Sunucu Bilgilerini Düzenle"
                      >
                        <Settings className="w-4 h-4" />
                      </button>

                      {/* Delete Host */}
                      <button
                        onClick={() => handleDeleteHost(h.id)}
                        className="p-2.5 rounded-xl bg-slate-900 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 border border-slate-800 transition"
                        title="Sunucuyu Sil"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* ADD NEW SERVER QUICK CARD */}
              <div
                onClick={() => setActiveModal('addHost')}
                className="glass-card rounded-2xl p-6 border-dashed border-slate-800 hover:border-cyan-500/50 flex flex-col items-center justify-center text-center cursor-pointer transition min-h-[220px] group"
              >
                <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 mb-3 group-hover:scale-110 transition">
                  <Plus className="w-6 h-6" />
                </div>
                <h4 className="font-bold text-sm text-slate-200 group-hover:text-cyan-300">Yeni Sunucu Ekle</h4>
                <p className="text-xs text-slate-400 mt-1 max-w-[200px]">
                  Filonuza Hyper-V veya fiziksel bir Windows makinesi kaydedin
                </p>
              </div>
            </div>

          </div>
        )}

        {/* =========================================================================
            TAB 3: PROCESSES & POWER HUB
        ========================================================================= */}
        {activeTab === 'processes' && (
          <div className="flex-1 flex flex-col p-6 overflow-y-auto bg-grid-pattern">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                  <Cpu className="w-5 h-5 text-indigo-400" /> Uzak Süreçler & Güç Yöneticisi
                </h2>
                <p className="text-xs text-slate-400">Hedef makinedeki aktif Windows süreçleri ve sistem güç seçenekleri</p>
              </div>

              {/* POWER ACTIONS BAR */}
              <div className="flex items-center gap-2 bg-slate-950 p-1.5 rounded-xl border border-slate-800">
                <button
                  onClick={() => sendPowerAction('logoff')}
                  className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 text-xs font-semibold flex items-center gap-1.5 transition"
                >
                  <User className="w-3.5 h-3.5" /> Oturumu Kapat
                </button>
                <button
                  onClick={() => sendPowerAction('reboot')}
                  className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-orange-500/20 text-orange-400 border border-orange-500/30 text-xs font-semibold flex items-center gap-1.5 transition"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Yeniden Başlat
                </button>
                <button
                  onClick={() => sendPowerAction('shutdown')}
                  className="px-3 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 border border-rose-500/40 text-xs font-semibold flex items-center gap-1.5 transition"
                >
                  <Power className="w-3.5 h-3.5" /> Bilgisayarı Kapat
                </button>
              </div>
            </div>

            {/* PROCESSES TABLE */}
            <div className="glass-card rounded-2xl overflow-hidden border border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-900/90 text-slate-400 border-b border-slate-800 font-mono text-[11px] uppercase tracking-wider">
                  <tr>
                    <th className="p-3">PID</th>
                    <th className="p-3">İşlem Adı</th>
                    <th className="p-3">Kullanıcı / Hak</th>
                    <th className="p-3">CPU Kullanımı</th>
                    <th className="p-3 text-right">Eylem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 font-mono">
                  {processes.map(p => (
                    <tr key={p.Id} className="hover:bg-slate-900/50 transition">
                      <td className="p-3 text-cyan-400 font-bold">{p.Id}</td>
                      <td className="p-3 font-sans font-bold text-slate-200">{p.ProcessName}</td>
                      <td className="p-3 text-slate-400">
                        <span className="px-2 py-0.5 rounded bg-slate-900 text-[10px] border border-slate-800">
                          {p.User || 'SYSTEM'}
                        </span>
                      </td>
                      <td className="p-3 text-emerald-400">{p.CPU}</td>
                      <td className="p-3 text-right">
                        <button
                          onClick={() => handleKillProcess(p.Id)}
                          className="px-2.5 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/30 text-[11px] transition font-sans font-semibold"
                        >
                          Sonlandır
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* =========================================================================
            TAB 4: FILE EXPLORER (GERÇEK UZAK DOSYA YÖNETİCİSİ)
        ========================================================================= */}
        {activeTab === 'files' && (
          <div className="flex-1 flex flex-col p-6 overflow-hidden bg-grid-pattern">
            
            {/* Header & Main Actions */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                  <Folder className="w-5 h-5 text-cyan-400" /> Uzak Dosya Gezgini & Denetim Masası
                </h2>
                <p className="text-xs text-slate-400">
                  {isConnected
                    ? `${agentInfo?.hostname || targetHost} üzerindeki dosyalara tam erişim (SYSTEM Yetkisi)`
                    : 'Uzak sunucuya bağlı değilsiniz. Dosya işlemleri için lütfen önce bir sunucuya bağlanın.'}
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleUploadFile}
                  className="hidden"
                />
                
                <button
                  disabled={!isConnected}
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 hover:opacity-90 text-white font-bold text-xs flex items-center gap-1.5 shadow-[0_0_12px_rgba(56,189,248,0.2)] transition disabled:opacity-40"
                  title="Uzak sunucuya dosya gönder"
                >
                  <Upload className="w-3.5 h-3.5" /> Dosya Yükle
                </button>

                <button
                  disabled={!isConnected}
                  onClick={handleCreateFolder}
                  className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-40"
                  title="Yeni klasör aç"
                >
                  <Plus className="w-3.5 h-3.5 text-cyan-400" /> Yeni Klasör
                </button>

                <button
                  disabled={!isConnected}
                  onClick={() => requestFsList(remotePath)}
                  className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition disabled:opacity-40"
                  title="Yenile"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingFiles ? 'animate-spin text-cyan-400' : ''}`} />
                </button>
              </div>
            </div>

            {/* NOT CONNECTED WARNING */}
            {!isConnected ? (
              <div className="glass-card rounded-2xl p-8 flex flex-col items-center justify-center text-center my-auto">
                <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 mb-3">
                  <Folder className="w-7 h-7" />
                </div>
                <h3 className="font-bold text-base text-slate-200">Uzak Dosya Erişimi İçin Bağlantı Gerekli</h3>
                <p className="text-xs text-slate-400 max-w-md mt-1 mb-5">
                  Hedef bilgisayardaki sürücüleri (C:\, D:\) okumak, dosya indirmek veya yüklemek için aktif bir uzak masaüstü oturumu başlatmalısınız.
                </p>
                <button
                  onClick={() => setActiveTab('fleet')}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 hover:opacity-90 text-white font-bold text-xs flex items-center gap-2 shadow-[0_0_20px_rgba(56,189,248,0.25)] transition"
                >
                  <Server className="w-4 h-4" /> Sunucu Filosundan Bir Makineye Bağlan
                </button>
              </div>
            ) : (
              <div className="flex-1 glass-card rounded-2xl border border-slate-800 flex flex-col overflow-hidden p-4">
                
                {/* Drives Bar & Path Navigator */}
                <div className="flex flex-col sm:flex-row items-center gap-2 mb-3 bg-slate-950 p-2 rounded-xl border border-slate-800">
                  
                  {/* Drives Selector */}
                  <div className="flex items-center gap-1 shrink-0">
                    {remoteDrives.map(drive => (
                      <button
                        key={drive}
                        onClick={() => requestFsList(drive)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition ${
                          remotePath.startsWith(drive)
                            ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                            : 'bg-slate-900 text-slate-400 hover:text-white'
                        }`}
                      >
                        {drive}
                      </button>
                    ))}
                  </div>

                  <div className="h-4 w-px bg-slate-800 hidden sm:block"></div>

                  {/* Up Button */}
                  <button
                    onClick={() => handleNavigate('..')}
                    className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs font-mono flex items-center gap-1"
                    title="Üst Dizine Çık"
                  >
                    ⬆️ Üst Dizin
                  </button>

                  {/* Path Input */}
                  <form
                    onSubmit={(e) => { e.preventDefault(); requestFsList(remotePath); }}
                    className="flex-1 flex items-center gap-1 w-full"
                  >
                    <input
                      type="text"
                      value={remotePath}
                      onChange={(e) => setRemotePath(e.target.value)}
                      className="flex-1 bg-transparent border-none text-xs font-mono text-cyan-300 outline-none px-2"
                      placeholder="C:\..."
                    />
                    <button type="submit" className="text-[11px] font-mono text-slate-400 hover:text-cyan-400 px-2 py-0.5">
                      Git ↵
                    </button>
                  </form>

                  {/* Filter Search */}
                  <div className="relative w-full sm:w-48 shrink-0">
                    <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={fileSearch}
                      onChange={(e) => setFileSearch(e.target.value)}
                      placeholder="Dosya filtrele..."
                      className="w-full pl-8 pr-2 py-1 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 outline-none"
                    />
                  </div>
                </div>

                {/* File List Table */}
                <div className="flex-1 overflow-y-auto rounded-xl border border-slate-800/80 bg-slate-950/60">
                  {isLoadingFiles ? (
                    <div className="flex flex-col items-center justify-center h-48 text-slate-500 gap-2">
                      <RefreshCw className="w-6 h-6 animate-spin text-cyan-400" />
                      <span className="text-xs font-mono">DİZİN LİSTELENİYOR...</span>
                    </div>
                  ) : (
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-900/90 text-slate-400 border-b border-slate-800 font-mono text-[11px] uppercase sticky top-0 z-10">
                        <tr>
                          <th className="p-3">Ad</th>
                          <th className="p-3 w-32">Değiştirilme</th>
                          <th className="p-3 w-24">Boyut</th>
                          <th className="p-3 w-40 text-right">Eylemler</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 font-mono">
                        {/* Parent Directory Link */}
                        <tr
                          onClick={() => handleNavigate('..')}
                          className="hover:bg-cyan-500/5 cursor-pointer text-slate-400 transition"
                        >
                          <td className="p-3 flex items-center gap-2 font-bold text-slate-300">
                            <Folder className="w-4 h-4 text-cyan-400" /> .. (Üst Klasör)
                          </td>
                          <td className="p-3 text-slate-600">—</td>
                          <td className="p-3 text-slate-600">—</td>
                          <td className="p-3 text-right"></td>
                        </tr>

                        {remoteFiles
                          .filter(f => f.name.toLowerCase().includes(fileSearch.toLowerCase()))
                          .map((file, i) => (
                            <tr
                              key={`${file.name}-${i}`}
                              className="hover:bg-slate-900/60 transition group"
                            >
                              <td
                                className="p-3 cursor-pointer"
                                onClick={() => file.isDirectory && handleNavigate(file.name)}
                              >
                                <div className="flex items-center gap-2.5">
                                  {file.isDirectory ? (
                                    <Folder className="w-4 h-4 text-cyan-400 shrink-0" />
                                  ) : file.name.endsWith('.exe') || file.name.endsWith('.bat') ? (
                                    <Terminal className="w-4 h-4 text-emerald-400 shrink-0" />
                                  ) : (
                                    <HardDrive className="w-4 h-4 text-slate-400 shrink-0" />
                                  )}
                                  <span className={`font-sans font-medium ${file.isDirectory ? 'text-cyan-300 hover:underline font-bold' : 'text-slate-200'}`}>
                                    {file.name}
                                  </span>
                                </div>
                              </td>

                              <td className="p-3 text-slate-400 text-[11px]">
                                {file.modified || '—'}
                              </td>

                              <td className="p-3 text-slate-400 text-[11px]">
                                {file.isDirectory
                                  ? '<DİZİN>'
                                  : file.size > 1024 * 1024
                                  ? `${(file.size / (1024 * 1024)).toFixed(2)} MB`
                                  : `${Math.ceil(file.size / 1024)} KB`}
                              </td>

                              <td className="p-3 text-right">
                                <div className="flex items-center justify-end gap-1.5 opacity-90 group-hover:opacity-100">
                                  {!file.isDirectory && (
                                    <>
                                      <button
                                        onClick={() => handleDownloadFile(file)}
                                        className="p-1.5 rounded-lg bg-slate-900 hover:bg-cyan-500/20 text-slate-400 hover:text-cyan-400 border border-slate-800 transition"
                                        title="Tarayıcıya İndir"
                                      >
                                        <Download className="w-3.5 h-3.5" />
                                      </button>

                                      {(file.name.endsWith('.exe') || file.name.endsWith('.bat') || file.name.endsWith('.cmd')) && (
                                        <button
                                          onClick={() => handleExecuteFile(file)}
                                          className="p-1.5 rounded-lg bg-slate-900 hover:bg-emerald-500/20 text-slate-400 hover:text-emerald-400 border border-slate-800 transition"
                                          title="Uzak Sunucuda Çalıştır (SYSTEM)"
                                        >
                                          <Play className="w-3.5 h-3.5 fill-current" />
                                        </button>
                                      )}
                                    </>
                                  )}

                                  <button
                                    onClick={() => handleDeleteFile(file)}
                                    className="p-1.5 rounded-lg bg-slate-900 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 border border-slate-800 transition"
                                    title="Uzak Sunucudan Sil"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}

                        {remoteFiles.length === 0 && (
                          <tr>
                            <td colSpan={4} className="p-8 text-center text-slate-500 font-sans">
                              Bu klasör boş veya okuma izni yok.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}

          </div>
        )}

        {/* =========================================================================
            TAB 5: OPS CHAT
        ========================================================================= */}
        {activeTab === 'chat' && (
          <div className="flex-1 flex flex-col p-6 overflow-hidden bg-grid-pattern">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                  <MessageSquare className="w-5 h-5 text-emerald-400" /> Operasyon & Kullanıcı Sohbeti
                </h2>
                <p className="text-xs text-slate-400">Uzak makinedeki kullanıcı ile gerçek zamanlı yazışma ve destek</p>
              </div>

              {isConnected && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={sendAudioBeep}
                    className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition"
                    title="Karşı bilgisayarda Windows dikkat sesi çal"
                  >
                    <Bell className="w-3.5 h-3.5 text-amber-400" /> Karşıda Zil Çal
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('console')}
                    className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-cyan-600 to-sky-600 hover:from-cyan-500 hover:to-sky-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-cyan-600/25 transition cursor-pointer"
                  >
                    <Monitor className="w-3.5 h-3.5" /> 🖥️ Masaüstü Yayınına Dön
                  </button>
                </div>
              )}
            </div>

            {/* Connection Status Banner */}
            {isConnected ? (
              <div className="mb-3 px-4 py-2.5 rounded-xl bg-slate-950/80 border border-emerald-500/30 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 pulse-dot"></span>
                  <span className="text-emerald-300 font-bold">Canlı Bağlantı Aktif:</span>
                  <span className="font-mono text-slate-200">{agentInfo?.hostname || targetHost} ({targetHost}:{targetPort})</span>
                  <span className="text-slate-500">•</span>
                  <span className="text-slate-400">Karşı kullanıcının ekranında sohbet penceresi açık</span>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-800/40 font-bold">
                  CANLI İLETİŞİM
                </span>
              </div>
            ) : (
              <div className="mb-3 px-4 py-3 rounded-xl bg-slate-950/80 border border-amber-500/30 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-400" />
                  <span className="text-amber-300 font-medium">Aktif bir uzak masaüstü oturumu bağlı değil.</span>
                  <span className="text-slate-400">Karşı kullanıcı ile yazışmak için lütfen bir sunucuya bağlanın.</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveTab('fleet')}
                    className="px-3 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-[11px] font-semibold transition"
                  >
                    Sunucu Filosu
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('console')}
                    className="px-3 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-[11px] font-bold transition"
                  >
                    Canlı Konsola Git
                  </button>
                </div>
              </div>
            )}

            <div className="flex-1 glass-card rounded-2xl border border-slate-800 flex flex-col overflow-hidden p-4">
              <div className="flex-1 overflow-y-auto space-y-3 mb-4 pr-2">
                {chatMessages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-500 text-xs">
                    <MessageSquare className="w-10 h-10 text-slate-700 mb-2" />
                    <p>Henüz bir mesaj bulunmuyor.</p>
                    <p className="text-[11px] text-slate-600 mt-0.5">Aşağıdaki alandan karşı kullanıcıya ilk mesajınızı gönderebilirsiniz.</p>
                  </div>
                ) : (
                  chatMessages.map((msg, idx) => {
                    const isTech = msg.sender.includes('You') || msg.sender.includes('Technician') || msg.sender.includes('Teknisyen');
                    const isSys = msg.sender.includes('System') || msg.sender.includes('Sistem');
                    return (
                      <div
                        key={idx}
                        className={`p-3 rounded-2xl max-w-lg text-xs ${
                          isTech
                            ? 'ml-auto bg-gradient-to-r from-cyan-600 to-sky-600 text-white shadow-md'
                            : isSys
                            ? 'mx-auto bg-slate-900/60 border border-slate-800 text-slate-400 text-center w-full max-w-md'
                            : 'bg-slate-900 border border-slate-800 text-slate-200'
                        }`}
                      >
                        <div className="flex justify-between text-[10px] opacity-75 font-mono mb-1 gap-4">
                          <span className="font-bold">{msg.sender}</span>
                          <span>{msg.time}</span>
                        </div>
                        <div className="font-sans leading-relaxed break-words">{msg.text}</div>
                      </div>
                    );
                  })
                )}
                <div ref={chatEndRef} />
              </div>

              <form onSubmit={handleSendChat} className="flex gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder={isConnected ? "Karşı kullanıcıya mesaj ilet... (Enter ile gönder)" : "Mesaj yazmak için önce bir istemciye bağlanın..."}
                  disabled={!isConnected}
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 outline-none focus:border-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <button
                  type="submit"
                  disabled={!isConnected}
                  className="px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold flex items-center gap-1.5 transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" /> Gönder
                </button>
              </form>
            </div>
          </div>
        )}

        {/* =========================================================================
            TAB 6: AUTOMATED DEPLOYMENT & AGENT HUB
        ========================================================================= */}
        {activeTab === 'deployment' && (
          <div className="flex-1 flex flex-col p-6 overflow-y-auto bg-grid-pattern">
            <div className="max-w-4xl mx-auto w-full space-y-6">
              
              <div>
                <h2 className="text-xl font-extrabold text-slate-100 flex items-center gap-2.5">
                  <Zap className="w-6 h-6 text-amber-400" /> Otomatik Dağıtım & Ajan Yönetim Merkezi
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Yüzlerce istemciye (Active Directory veya Workgroup) tek tıkla dokunulmaz SYSTEM ajanını dağıtın
                </p>
              </div>

              {/* WORKGROUP 1-LINER SCRIPT CARD */}
              <div className="glass-card rounded-2xl p-6 border-cyan-500/30 shadow-[0_0_20px_rgba(56,189,248,0.1)]">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-5 h-5 text-cyan-400" />
                    <h3 className="font-bold text-sm text-slate-100">Tek Satırlık PowerShell Kurulum Kodu (Workgroup)</h3>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800/50">
                    DİNAMİK IP BAĞLANTISI
                  </span>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed mb-4">
                  Sıfır bir sanal veya fiziksel makineye uzaktan ilk bağlantıyı açmak için, hedef makinede <strong>PowerShell'i Yönetici Olarak Çalıştırın</strong> ve aşağıdaki kodu yapıştırın:
                </p>

                <div className="relative group mb-4">
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono text-[11px] text-cyan-300 whitespace-pre-wrap break-all select-all max-h-40 overflow-y-auto">
                    {setupCommand || 'Komut yükleniyor...'}
                  </div>
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => copyToClipboard(setupCommand)}
                    className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-bold text-xs flex items-center gap-2 shadow-[0_0_15px_rgba(56,189,248,0.25)] transition"
                  >
                    <Copy className="w-4 h-4" /> {copiedCode ? 'Başarıyla Kopyalandı!' : 'Kurulum Kodunu Kopyala'}
                  </button>

                  <a
                    href="/RemoteMM_Agent.exe"
                    download="RemoteMM_Agent.exe"
                    className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 font-semibold text-xs flex items-center gap-2 transition"
                  >
                    <Download className="w-4 h-4" /> Çevrimdışı .EXE İndir
                  </a>
                </div>
              </div>

              {/* ARCHITECTURE HIGHLIGHTS */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="glass-card rounded-2xl p-4">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mb-2">
                    <Shield className="w-4 h-4" />
                  </div>
                  <h4 className="font-bold text-xs text-slate-200">UAC & UIPI Bypass</h4>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Token Duplication ile SYSTEM ayrıcalığına sahip olur, Görev Yöneticisi ve sarı kalkanlı UAC pencerelerini tıklar.
                  </p>
                </div>

                <div className="glass-card rounded-2xl p-4">
                  <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center mb-2">
                    <Monitor className="w-4 h-4" />
                  </div>
                  <h4 className="font-bold text-xs text-slate-200">Winlogon Desktop</h4>
                  <p className="text-[11px] text-slate-400 mt-1">
                    SetThreadDesktop kütüphanemiz ile kilit ekranından kullanıcı masaüstüne geçişte asla siyah ekranda asılı kalmaz.
                  </p>
                </div>

                <div className="glass-card rounded-2xl p-4">
                  <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center mb-2">
                    <RefreshCw className="w-4 h-4" />
                  </div>
                  <h4 className="font-bold text-xs text-slate-200">Watchdog Dayanıklılığı</h4>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Oturum değiştiğinde veya bağlantı koptuğunda arka plandaki Session 0 gözlemcisi kendini anında canlandırır.
                  </p>
                </div>
              </div>

            </div>
          </div>
        )}

        {/* =========================================================================
            TAB 7: ENTERPRISE AUDIT LOGS & COMPLIANCE (KVKK / ISO 27001)
        ========================================================================= */}
        {activeTab === 'audit' && (
          <div className="flex-1 flex flex-col p-6 overflow-hidden bg-grid-pattern">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                  <Shield className="w-5 h-5 text-emerald-400" /> Kurumsal Denetim İzi & İşlem Kayıtları
                </h2>
                <p className="text-xs text-slate-400">KVKK, ISO 27001 ve SOC 2 uyumlu tahrif edilemez operasyon geçmişi</p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={fetchAuditLogs}
                  className="px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${isLoadingAudit ? 'animate-spin' : ''}`} /> Kayıtları Yenile
                </button>
              </div>
            </div>

            {/* Audit Logs Table Card */}
            <div className="flex-1 glass-card rounded-2xl border border-slate-800 flex flex-col overflow-hidden p-4">
              <div className="flex-1 overflow-y-auto pr-1">
                {auditLogs.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-500 text-xs">
                    <Shield className="w-12 h-12 text-slate-700 mb-2" />
                    <p className="font-semibold text-slate-400">Henüz kayıtlı bir denetim olayı bulunmuyor.</p>
                    <p className="text-[11px] text-slate-600 mt-1">Uzak bağlantı, dosya aktarımı veya güç eylemi yapıldığında burada listelenecektir.</p>
                  </div>
                ) : (
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 text-[10px] font-mono text-slate-400 uppercase tracking-wider bg-slate-950/60 sticky top-0 backdrop-blur-md">
                        <th className="py-2.5 px-3">Zaman</th>
                        <th className="py-2.5 px-3">Olay Kimliği</th>
                        <th className="py-2.5 px-3">Eylem</th>
                        <th className="py-2.5 px-3">Operatör</th>
                        <th className="py-2.5 px-3">Hedef Cihaz / Host</th>
                        <th className="py-2.5 px-3">Sonuç</th>
                        <th className="py-2.5 px-3">Detaylar</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                      {auditLogs.map((log, idx) => {
                        const isSuccess = log.result === 'SUCCESS';
                        return (
                          <tr key={log.eventId || idx} className="hover:bg-slate-900/50 transition">
                            <td className="py-2.5 px-3 text-slate-400 whitespace-nowrap">
                              {log.timestamp ? new Date(log.timestamp).toLocaleString('tr-TR') : 'N/A'}
                            </td>
                            <td className="py-2.5 px-3 text-cyan-400 font-bold">
                              {log.eventId || `aud_${idx}`}
                            </td>
                            <td className="py-2.5 px-3 font-semibold text-slate-200">
                              <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px]">
                                {log.action}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-slate-300">
                              {log.operator || 'system'}
                            </td>
                            <td className="py-2.5 px-3 text-emerald-400 font-bold">
                              {log.targetHost || log.targetDeviceId || 'NOC Hub'}
                            </td>
                            <td className="py-2.5 px-3">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                isSuccess
                                  ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/40'
                                  : 'bg-rose-950/80 text-rose-400 border border-rose-800/40'
                              }`}>
                                {log.result || 'OK'}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-slate-400 truncate max-w-xs text-[10px]" title={JSON.stringify(log.parameters || {})}>
                              {log.parameters ? JSON.stringify(log.parameters) : '-'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}

      </div>

      {/* ─────────────────────────────────────────────────────────────
          BOTTOM NOC STATUS TICKER BAR
      ───────────────────────────────────────────────────────────── */}
      <footer className="h-7 bg-[#070b14] border-t border-slate-800/80 px-4 flex items-center justify-between text-[11px] font-mono text-slate-500 shrink-0">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 text-slate-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
            RemoteMM NOC Engine: <strong className="text-slate-300">Active</strong>
          </span>
          <span>•</span>
          <span>Gateway: <strong className="text-cyan-400">127.0.0.1:3001</strong></span>
          <span>•</span>
          <span>Winlogon Capture: <strong className="text-emerald-400">Enabled</strong></span>
        </div>
        <div className="flex items-center gap-4">
          <span>Encoding: <strong className="text-slate-300">JPEG Turbo GDI</strong></span>
          <span>•</span>
          <span>Fleet: <strong className="text-cyan-400">{allHosts.length} Node</strong></span>
        </div>
      </footer>

      {/* ─────────────────────────────────────────────────────────────
          MODALS
      ───────────────────────────────────────────────────────────── */}

      {/* MODAL 1: ADD NEW HOST */}
      {activeModal === 'addHost' && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-[520px] glass-card rounded-2xl border border-cyan-500/30 overflow-hidden shadow-[0_0_40px_rgba(56,189,248,0.15)] animate-in zoom-in-95 duration-150">
            <div className="h-12 px-5 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
              <span className="font-bold text-sm text-slate-100 flex items-center gap-2">
                <Plus className="w-4 h-4 text-cyan-400" /> Filonuza Yeni Sunucu Ekleyin
              </span>
              <button onClick={() => setActiveModal(null)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddHost} className="p-6 space-y-4 text-xs">
              <div>
                <label className="text-slate-300 font-semibold mb-1 block">Sunucu Adı / Etiket:</label>
                <input
                  type="text"
                  required
                  value={newHostName}
                  onChange={(e) => setNewHostName(e.target.value)}
                  placeholder="Örn: makine1 (Sanal Makine)"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl outline-none text-slate-100 focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="text-slate-300 font-semibold mb-1 block">IP Adresi veya Hostname:</label>
                <input
                  type="text"
                  required
                  value={newHostIp}
                  onChange={(e) => setNewHostIp(e.target.value)}
                  placeholder="Örn: 172.31.132.183"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl outline-none text-slate-100 font-mono focus:border-cyan-500"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-slate-400 mb-1 block">Domain / Grup:</label>
                  <input
                    type="text"
                    value={newHostDomain}
                    onChange={(e) => setNewHostDomain(e.target.value)}
                    placeholder="WORKGROUP"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl outline-none text-slate-100 font-mono"
                  />
                </div>
                <div>
                  <label className="text-slate-400 mb-1 block">Yönetici Kullanıcı:</label>
                  <input
                    type="text"
                    value={newHostUser}
                    onChange={(e) => setNewHostUser(e.target.value)}
                    placeholder="Administrator"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl outline-none text-slate-100"
                  />
                </div>
                <div>
                  <label className="text-slate-400 mb-1 block">Şifre:</label>
                  <input
                    type="password"
                    value={newHostPass}
                    onChange={(e) => setNewHostPass(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl outline-none text-slate-100"
                  />
                </div>
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 hover:opacity-90 text-white font-bold"
                >
                  Sunucuyu Kaydet
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: EDIT HOST SETTINGS */}
      {activeModal === 'editHostSettings' && editingHost && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-[520px] glass-card rounded-2xl border border-slate-800 overflow-hidden shadow-2xl">
            <div className="h-12 px-5 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
              <span className="font-bold text-sm text-slate-100 flex items-center gap-2">
                <Settings className="w-4 h-4 text-amber-400" /> Sunucu Ayarlarını Düzenle
              </span>
              <button onClick={() => setActiveModal(null)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveHostSettings} className="p-6 space-y-4 text-xs">
              <div>
                <label className="text-slate-400 mb-1 block">Sunucu Başlığı:</label>
                <input
                  type="text"
                  required
                  value={editingHost.name}
                  onChange={(e) => setEditingHost({ ...editingHost, name: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 mb-1 block">IP / Hostname:</label>
                  <input
                    type="text"
                    required
                    value={editingHost.ip}
                    onChange={(e) => setEditingHost({ ...editingHost, ip: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl font-mono text-slate-100"
                  />
                </div>
                <div>
                  <label className="text-slate-400 mb-1 block">Port:</label>
                  <input
                    type="text"
                    value={editingHost.port || '6129'}
                    onChange={(e) => setEditingHost({ ...editingHost, port: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl font-mono text-slate-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-slate-400 mb-1 block">Domain:</label>
                  <input
                    type="text"
                    value={editingHost.domain || 'WORKGROUP'}
                    onChange={(e) => setEditingHost({ ...editingHost, domain: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-100"
                  />
                </div>
                <div>
                  <label className="text-slate-400 mb-1 block">Kullanıcı:</label>
                  <input
                    type="text"
                    value={editingHost.user || 'Administrator'}
                    onChange={(e) => setEditingHost({ ...editingHost, user: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-100"
                  />
                </div>
                <div>
                  <label className="text-slate-400 mb-1 block">Şifre:</label>
                  <input
                    type="password"
                    value={editingHost.pass || ''}
                    onChange={(e) => setEditingHost({ ...editingHost, pass: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-100"
                    placeholder="••••••••"
                  />
                </div>
              </div>

              <div>
                <label className="text-slate-400 mb-1 block">MAC Adresi (Wake-on-LAN için):</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={editingHost.mac || ''}
                    placeholder="Örn: 00:1A:2B:3C:4D:5E (Otomatik algılanır)"
                    onChange={(e) => setEditingHost({ ...editingHost, mac: e.target.value.toUpperCase() })}
                    className="flex-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl font-mono text-slate-100"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      if (!editingHost.ip) return;
                      try {
                        const res = await fetch(`http://localhost:3001/api/power/mac?ip=${encodeURIComponent(editingHost.ip)}`);
                        const data = await res.json();
                        if (data.mac) {
                          setEditingHost(prev => ({ ...prev, mac: data.mac.toUpperCase() }));
                        } else {
                          alert('Bu IP için ağda MAC adresi bulunamadı. Makine açıkken tekrar deneyin.');
                        }
                      } catch (err) {
                        alert('MAC sorgulama hatası: ' + err.message);
                      }
                    }}
                    className="px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-cyan-400 border border-slate-800 font-bold transition flex items-center gap-1.5"
                    title="Ağdaki ARP tablosundan MAC adresini otomatik getir"
                  >
                    <Search className="w-3.5 h-3.5" /> Bul
                  </button>
                </div>
              </div>

              <div className="pt-3 flex justify-between items-center border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => handleDeleteHost(editingHost.id)}
                  className="px-3 py-2 bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/30 rounded-xl font-medium text-xs flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Sunucuyu Sil
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveModal(null)}
                    className="px-4 py-2 bg-slate-900 text-slate-300 rounded-xl hover:bg-slate-800"
                  >
                    Vazgeç
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl font-bold"
                  >
                    Değişiklikleri Kaydet
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: AGENT QUICK INSTALL COMMAND DIALOG */}
      {activeModal === 'agentInstall' && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-[540px] glass-card rounded-2xl border border-cyan-500/30 overflow-hidden shadow-2xl">
            <div className="h-12 px-5 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
              <span className="font-bold text-sm text-slate-100 flex items-center gap-2">
                <Terminal className="w-4 h-4 text-cyan-400" /> RemoteMM Hızlı Kurulum Betiği
              </span>
              <button onClick={() => setActiveModal(null)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <p className="text-slate-300 leading-relaxed">
                Yeni bir Windows makinesini bu panele bağlamak için, hedef makinede <strong>PowerShell'i Yönetici Olarak Çalıştırın</strong> ve aşağıdaki kodu yapıştırın:
              </p>

              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono text-[11px] text-cyan-300 whitespace-pre-wrap break-all select-all max-h-44 overflow-y-auto">
                {setupCommand || 'Yükleniyor...'}
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => copyToClipboard(setupCommand)}
                  className="flex-1 py-2.5 bg-gradient-to-r from-cyan-600 to-indigo-600 hover:opacity-90 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 transition"
                >
                  <Copy className="w-4 h-4" /> {copiedCode ? 'Kopyalandı!' : 'Kodu Kopyala'}
                </button>
                <a
                  href="/RemoteMM_Agent.exe"
                  download="RemoteMM_Agent.exe"
                  className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 font-semibold rounded-xl text-xs flex items-center justify-center gap-2 transition"
                >
                  <Download className="w-4 h-4" /> .EXE İndir
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: FULL-SCREEN LIVE SCREEN PREVIEW & REMOTE SURVEILLANCE */}
      {previewModalHost && (
        <div
          className="fixed inset-0 bg-black/90 backdrop-blur-md z-50 flex flex-col items-center justify-center p-4"
          onClick={() => setPreviewModalHost(null)}
        >
          <div
            className="max-w-5xl w-full bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-5 py-3.5 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse"></div>
                <div>
                  <h3 className="font-bold text-sm text-slate-200 flex items-center gap-2">
                    {previewModalHost.name}
                    <span className="text-xs font-mono text-cyan-400 font-normal">({previewModalHost.ip})</span>
                  </h3>
                  <p className="text-[11px] text-slate-400 font-mono">
                    Canlı Gözetim Önizlemesi • Bağlantı Kurulmadan Doğrudan Görüntüleniyor
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => pollFleetStatus([previewModalHost], true)}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 text-xs font-semibold flex items-center gap-1.5 border border-slate-700 transition"
                >
                  <Camera className="w-3.5 h-3.5" /> Şimdi Yenile
                </button>
                <button
                  onClick={() => {
                    const target = previewModalHost;
                    setPreviewModalHost(null);
                    handleConnect(target);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-cyan-600 to-sky-500 hover:opacity-90 text-white font-bold text-xs flex items-center gap-1.5 transition"
                >
                  <Monitor className="w-3.5 h-3.5" /> Canlı Bağlan & Yönet
                </button>
                <button
                  onClick={() => setPreviewModalHost(null)}
                  className="p-1.5 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Screen Frame Display */}
            <div className="p-4 bg-black flex items-center justify-center min-h-[420px] max-h-[75vh] overflow-hidden">
              {hostSnapshots[previewModalHost.id]?.snapshot ? (
                <img
                  src={hostSnapshots[previewModalHost.id].snapshot}
                  alt={`${previewModalHost.name} Canlı Ekran`}
                  className="max-h-[70vh] w-auto max-w-full object-contain rounded-lg border border-slate-800 shadow-2xl"
                />
              ) : (
                <div className="flex flex-col items-center justify-center text-slate-500 py-16">
                  <Monitor className="w-12 h-12 mb-3 text-slate-600 animate-pulse" />
                  <p className="text-sm font-semibold text-slate-300">Ekran görüntüsü alınıyor...</p>
                  <p className="text-xs text-slate-500 mt-1">Ajan üzerinden anlık görüntü talep edildi</p>
                </div>
              )}
            </div>

            {/* Footer Power Actions in Modal */}
            <div className="px-5 py-3 bg-slate-900/90 border-t border-slate-800 flex items-center justify-between text-xs font-mono">
              <div className="text-slate-400 flex items-center gap-3">
                <span>Kullanıcı: <b className="text-slate-200">{hostSnapshots[previewModalHost.id]?.user || previewModalHost.user || 'Administrator'}</b></span>
                {hostSnapshots[previewModalHost.id]?.width && (
                  <span>Çözünürlük: <b className="text-slate-200">{hostSnapshots[previewModalHost.id].width}x{hostSnapshots[previewModalHost.id].height}</b></span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleRemotePowerAction(previewModalHost, 'lock')}
                  className="px-2.5 py-1.5 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border border-blue-500/40 text-xs font-semibold flex items-center gap-1.5 transition"
                >
                  <Lock className="w-3.5 h-3.5" /> Kilitle
                </button>
                <button
                  onClick={() => handleRemotePowerAction(previewModalHost, 'reboot')}
                  className="px-2.5 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-semibold flex items-center gap-1.5 transition"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Yeniden Başlat
                </button>
                <button
                  onClick={() => handleRemotePowerAction(previewModalHost, 'shutdown')}
                  className="px-2.5 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-xs font-semibold flex items-center gap-1.5 transition"
                >
                  <Power className="w-3.5 h-3.5" /> Kapat
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
