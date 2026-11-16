import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { formatDateTime } from './dates.js';
import DashboardShell, { Avatar } from './DashboardShell.jsx';

function formatTimer(total) {
  const seconds = Math.max(0, Math.floor(total || 0));
  return [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60]
    .map(value => String(value).padStart(2, '0')).join(':');
}

function formatHours(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  if (value < 60) return '0m';
  if (value < 3600) return `${Math.floor(value / 60)}m`;
  return `${(value / 3600).toFixed(1)}h`;
}

const eventLabels = {
  room_created: 'Room created',
  member_joined: 'Member joined',
  member_left: 'Member left',
  timer_started: 'Focus timer started',
  timer_stopped: 'Focus timer paused',
  pomodoro_started: 'Shared timer started',
  pomodoro_paused: 'Shared timer paused',
  pomodoro_reset: 'Shared timer reset',
  pomodoro_complete: 'Pomodoro completed',
  pomodoro_phase: 'Phase changed',
  room_updated: 'Room settings updated'
};

function VisibilityBadge({ value }) {
  return <span className={`study-visibility ${value === 'public' ? 'public' : 'private'}`}>{value === 'public' ? 'Public' : 'Private'}</span>;
}

async function copyText(value) {
  try { await navigator.clipboard.writeText(value); return true; } catch { return false; }
}

function RoomCard({ room, onOpen, onJoin, onCopy, busy }) {
  const joined = room.joined !== false;
  return <article className="study-room-card">
    <div className="study-room-card-top">
      <VisibilityBadge value={room.visibility}/>
      <span className="study-room-live"><i className={room.online_count ? 'live' : ''}/>{room.online_count || 0} online</span>
    </div>
    <h3>{room.name}</h3>
    <p>{room.description || (room.owner_name ? `Hosted by ${room.owner_name}.` : 'A focused space to study together.')}</p>
    <div className="study-room-card-meta">
      <span>{room.member_count} member{room.member_count === 1 ? '' : 's'}</span>
      <span>{room.role === 'owner' ? 'You own this room' : room.role === 'member' ? 'You’re a member' : 'Open to join'}</span>
    </div>
    <div className="study-room-card-actions">
      {joined && <button className="button small" type="button" onClick={onOpen}>Open room</button>}
      {!joined && <button className="button small" type="button" disabled={busy} onClick={onJoin}>Join room</button>}
      {joined && room.join_code && <button className="text-button" type="button" onClick={() => onCopy(room.join_code)}>Copy invite</button>}
    </div>
  </article>;
}

function StudyHub({ api, navigate }) {
  const [rooms, setRooms] = useState([]);
  const [publicRooms, setPublicRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState('private');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [mine, catalog] = await Promise.all([api('/study-rooms'), api('/study-rooms/public')]);
      setRooms(mine.rooms || []);
      setPublicRooms((catalog.rooms || []).filter(room => !room.joined));
    } catch (value) { setError(value.message); }
    finally { setLoading(false); }
  }, [api]);

  useEffect(() => { refresh(); }, [refresh]);

  async function run(action, key = '') {
    setError('');
    setNotice('');
    setBusy(key);
    try { await action(); }
    catch (value) { setError(value.message); }
    finally { setBusy(''); }
  }

  async function createRoom(event) {
    event.preventDefault();
    await run(async () => {
      const data = await api('/study-rooms', { method: 'POST', body: JSON.stringify({ name, description, visibility }) });
      navigate(`/dashboard/study/${encodeURIComponent(data.room.id)}`);
    }, 'create');
  }

  async function joinByCode(event) {
    event.preventDefault();
    await run(async () => {
      const data = await api('/study-rooms/join', { method: 'POST', body: JSON.stringify({ join_code: code }) });
      setCode('');
      navigate(`/dashboard/study/${encodeURIComponent(data.room.id)}`);
    }, 'code');
  }

  async function joinPublic(room) {
    await run(async () => {
      const data = await api(`/study-rooms/${encodeURIComponent(room.id)}/join`, { method: 'POST' });
      navigate(`/dashboard/study/${encodeURIComponent(data.room.id)}`);
    }, `join-${room.id}`);
  }

  async function copyInvite(value) {
    setNotice(await copyText(value) ? 'Invite code copied. Share it with a friend.' : `Invite code: ${value}`);
  }

  return <>
    <div className="study-hub-grid">
      <section className="dash-panel">
        <span className="eyebrow">FOCUS TOGETHER</span>
        <h2>Create a study room</h2>
        <p>Choose a private room for invited friends or a public room that anyone can join. You can change this later in room settings.</p>
        <form className="study-form" onSubmit={createRoom}>
          <label>Room name<input value={name} maxLength="80" required onChange={event => setName(event.target.value)} placeholder="e.g. DSA sprint circle"/></label>
          <label>Description <span className="optional">optional</span><textarea value={description} maxLength="300" rows="2" onChange={event => setDescription(event.target.value)} placeholder="What are you studying together?"/></label>
          <label>Visibility<select value={visibility} onChange={event => setVisibility(event.target.value)}><option value="private">Private · invite code only</option><option value="public">Public · discoverable</option></select></label>
          <button className="button small" disabled={busy === 'create'}>{busy === 'create' ? 'Creating…' : 'Create room'}</button>
        </form>
        <h2>Join with an invite code</h2>
        <form className="community-form" onSubmit={joinByCode}>
          <input value={code} maxLength="10" required onChange={event => setCode(event.target.value.toUpperCase())} placeholder="Invite code" aria-label="Invite code"/>
          <button className="button secondary small" disabled={busy === 'code'}>Join room</button>
        </form>
        {notice && <div className="empty-card" role="status">{notice}</div>}
        {error && <div className="empty-card" role="alert">{error}</div>}
      </section>
      <section className="dash-panel">
        <div className="panel-heading"><div><span className="eyebrow">PUBLIC ROOMS</span><h2>Study with the community</h2></div></div>
        <p>Public rooms show real member and online counts. Join one to share focus time, chat and a Pomodoro timer.</p>
        {loading ? <p role="status">Loading public rooms…</p> : publicRooms.length
          ? <div className="study-room-list">{publicRooms.slice(0, 8).map(room => <RoomCard key={room.id} room={room} busy={busy === `join-${room.id}`} onOpen={() => navigate(`/dashboard/study/${encodeURIComponent(room.id)}`)} onJoin={() => joinPublic(room)} onCopy={copyInvite}/>)}</div>
          : <div className="empty-state"><span>◎</span><h3>No public rooms right now.</h3><p>Create one and invite others, or join a private room with a code.</p></div>}
      </section>
    </div>
    <section className="dash-panel study-my-rooms">
      <div className="panel-heading"><div><span className="eyebrow">YOUR ROOMS</span><h2>Where you’re studying</h2></div></div>
      {loading ? <p role="status">Loading your rooms…</p> : rooms.length
        ? <div className="study-room-list">{rooms.map(room => <RoomCard key={room.id} room={room} onOpen={() => navigate(`/dashboard/study/${encodeURIComponent(room.id)}`)} onCopy={copyInvite}/>)}</div>
        : <div className="empty-state"><span>✳</span><h3>No rooms yet.</h3><p>Create your first room above, or join one with an invite code.</p></div>}
    </section>
    <div className="account-links"><Link to="/dashboard/leaderboard">Leaderboard ↗</Link><Link to="/dashboard">Back to overview ↗</Link></div>
  </>;
}

function StudyRoomView({ api, roomId, navigate }) {
  const [room, setRoom] = useState(null);
  const [members, setMembers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [events, setEvents] = useState([]);
  const [timer, setTimer] = useState(null);
  const [pomodoro, setPomodoro] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [progress, setProgress] = useState(null);
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [now, setNow] = useState(Date.now());
  const [syncedAt, setSyncedAt] = useState(Date.now());
  const [timerUpdatedAt, setTimerUpdatedAt] = useState(Date.now());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState({ name: '', description: '', visibility: 'private' });

  const refreshRoom = useCallback(async () => {
    const data = await api(`/study-rooms/${encodeURIComponent(roomId)}`);
    setRoom(data.room);
    setMembers(data.members || []);
    setMessages(data.messages || []);
    setEvents(data.events || []);
    setTimer(data.timer || null);
    setPomodoro(data.pomodoro || null);
    setLeaderboard(data.room_leaderboard || []);
    setProgress(data.room_progress || null);
    setTimerUpdatedAt(Date.now());
    setSyncedAt(Date.now());
    if (data.room) setSettings({ name: data.room.name || '', description: data.room.description || '', visibility: data.room.visibility === 'public' ? 'public' : 'private' });
  }, [api, roomId]);

  useEffect(() => {
    let alive = true;
    const update = () => refreshRoom().catch(value => { if (alive) setError(value.message); });
    update();
    const interval = setInterval(update, 5000);
    return () => { alive = false; clearInterval(interval); };
  }, [refreshRoom]);

  useEffect(() => {
    if (!timer?.active) return;
    let alive = true;
    const heartbeat = async () => { try { await api(`/study-rooms/${encodeURIComponent(roomId)}/timer/heartbeat`, { method: 'POST' }); } catch (value) { if (alive) setError(value.message); } };
    const interval = setInterval(heartbeat, 15000);
    return () => { alive = false; clearInterval(interval); };
  }, [api, roomId, timer?.active]);

  useEffect(() => { const tick = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(tick); }, []);

  async function run(action, key = '') {
    setError('');
    setNotice('');
    setBusy(key);
    try { await action(); }
    catch (value) { setError(value.message); }
    finally { setBusy(''); }
  }

  async function toggleTimer() {
    if (busy) return;
    await run(async () => {
      const data = await api(`/study-rooms/${encodeURIComponent(roomId)}/timer/${timer?.active ? 'stop' : 'start'}`, { method: 'POST' });
      setTimer(data.timer || null);
      setTimerUpdatedAt(Date.now());
      await refreshRoom();
    }, 'timer');
  }

  async function pomodoroAction(action) {
    await run(async () => {
      const data = await api(`/study-rooms/${encodeURIComponent(roomId)}/pomodoro`, { method: 'POST', body: JSON.stringify({ action }) });
      setPomodoro(data.pomodoro || null);
      setSyncedAt(Date.now());
      await refreshRoom();
    }, `pomodoro-${action}`);
  }

  async function sendMessage(event) {
    event.preventDefault();
    if (!message.trim()) return;
    await run(async () => {
      await api(`/study-rooms/${encodeURIComponent(roomId)}/messages`, { method: 'POST', body: JSON.stringify({ content: message }) });
      setMessage('');
      await refreshRoom();
    }, 'message');
  }

  async function saveSettings(event) {
    event.preventDefault();
    await run(async () => {
      await api(`/study-rooms/${encodeURIComponent(roomId)}/settings`, { method: 'POST', body: JSON.stringify(settings) });
      setNotice('Room settings saved.');
      setSettingsOpen(false);
      await refreshRoom();
    }, 'settings');
  }

  async function leaveRoom() {
    await run(async () => {
      await api(`/study-rooms/${encodeURIComponent(roomId)}/membership`, { method: 'DELETE' });
      navigate('/dashboard/study');
    }, 'leave');
  }

  async function deleteRoom() {
    if (!window.confirm('Delete this study room, its chat history and its activity log?')) return;
    await run(async () => {
      await api(`/study-rooms/${encodeURIComponent(roomId)}`, { method: 'DELETE' });
      navigate('/dashboard/study');
    }, 'delete');
  }

  async function copyInvite() {
    if (!room) return;
    setNotice(await copyText(room.join_code) ? 'Invite code copied. Share it with a friend.' : `Invite code: ${room.join_code}`);
  }

  const ownSeconds = (timer?.individual_seconds || 0) + (timer?.active ? Math.max(0, Math.floor((now - timerUpdatedAt) / 1000)) : 0);
  const groupSeconds = (timer?.group_seconds || 0) + (timer?.active_members ? Math.max(0, Math.floor((now - timerUpdatedAt) / 1000)) : 0);
  const maxMemberSeconds = Math.max(1, ...leaderboard.map(row => row.study_seconds));
  const pomodoroRemaining = pomodoro ? Math.max(0, Math.round(pomodoro.remaining - (pomodoro.running ? (now - syncedAt) / 1000 : 0))) : 0;
  const pomodoroPercent = pomodoro ? Math.min(100, Math.max(0, ((pomodoro.duration - pomodoroRemaining) / pomodoro.duration) * 100)) : 0;

  if (error && !room) return <div className="dash-panel"><p role="alert">{error}</p><Link className="button small" to="/dashboard/study">Back to study rooms</Link></div>;
  if (!room) return <div className="dash-panel" role="status">Loading your study room…</div>;

  return <>
    <div className="study-room-header">
      <div>
        <Link to="/dashboard/study" className="study-back">← All study rooms</Link>
        <h1>{room.name}</h1>
        <p>{room.description || 'A shared space for focused study.'} · Hosted by {room.owner_name || 'the room owner'}.</p>
        <div className="study-room-tags">
          <VisibilityBadge value={room.visibility}/>
          <span>{room.member_count} members</span>
          <span>{room.online_count} online now</span>
        </div>
      </div>
      <div className="study-room-actions">
        <button className="study-code" type="button" onClick={copyInvite} title="Copy invite code">Invite · {room.join_code}</button>
        {room.owner && <button className="button secondary small" type="button" onClick={() => setSettingsOpen(value => !value)}>{settingsOpen ? 'Close settings' : 'Manage room'}</button>}
      </div>
    </div>

    {notice && <div className="empty-card" role="status">{notice}</div>}
    {error && <div className="empty-card" role="alert">{error}</div>}

    {settingsOpen && room.owner && <form className="dash-panel study-settings" onSubmit={saveSettings}>
      <span className="eyebrow">ROOM SETTINGS</span>
      <div className="study-form">
        <label>Room name<input value={settings.name} maxLength="80" required onChange={event => setSettings(value => ({ ...value, name: event.target.value }))}/></label>
        <label>Description<textarea value={settings.description} maxLength="300" rows="2" onChange={event => setSettings(value => ({ ...value, description: event.target.value }))}/></label>
        <label>Visibility<select value={settings.visibility} onChange={event => setSettings(value => ({ ...value, visibility: event.target.value }))}><option value="private">Private · invite code only</option><option value="public">Public · discoverable</option></select></label>
        <div className="community-row-actions"><button className="button small" disabled={busy === 'settings'}>Save settings</button><button type="button" className="text-button danger" onClick={deleteRoom} disabled={busy === 'delete'}>{busy === 'delete' ? 'Deleting…' : 'Delete room'}</button></div>
      </div>
    </form>}

    <div className="study-room-grid">
      <section className="dash-panel study-focus">
        <div className="study-pomodoro" aria-live="polite">
          <div className="study-pomodoro-head"><span className="eyebrow">SHARED POMODORO</span><span className={`study-phase ${pomodoro?.phase || 'focus'}`}>{pomodoro?.phase === 'break' ? 'Break' : 'Focus'}</span></div>
          <strong>{formatTimer(pomodoroRemaining)}</strong>
          <div className="study-pomo-bar" role="img" aria-label={`${Math.round(pomodoroPercent)}% of this phase complete`}><i style={{ width: `${pomodoroPercent}%` }}/></div>
          <small>{pomodoro?.running ? 'Running for everyone in this room.' : 'Paused. Start it when the room is ready.'} {pomodoro ? `Phase length ${Math.round((pomodoro.duration || 0) / 60)} min.` : ''}</small>
          <div className="study-pomodoro-actions">
            {pomodoro?.running
              ? <button className="button small" type="button" disabled={busy.startsWith('pomodoro')} onClick={() => pomodoroAction('pause')}>Pause</button>
              : <button className="button small" type="button" disabled={busy.startsWith('pomodoro')} onClick={() => pomodoroAction('start')}>{pomodoro && pomodoro.elapsed > 0 ? 'Resume' : 'Start'} {pomodoro?.phase === 'break' ? 'break' : 'focus'}</button>}
            <button className="button secondary small" type="button" disabled={busy.startsWith('pomodoro')} onClick={() => pomodoroAction('skip')}>{pomodoro?.phase === 'break' ? 'Start focus' : 'Take a break'}</button>
            <button className="text-button" type="button" disabled={busy.startsWith('pomodoro')} onClick={() => pomodoroAction('reset')}>Reset</button>
          </div>
        </div>

        <div className="study-timers">
          <div><span>Your focused time</span><strong>{formatTimer(ownSeconds)}</strong><small>{timer?.active ? 'Timer running on this account' : 'Paused for this account'}</small></div>
          <div><span>Group focused time</span><strong>{formatTimer(groupSeconds)}</strong><small>{timer?.active_members || 0} member(s) studying now</small></div>
          <button className="button small" onClick={toggleTimer} disabled={busy === 'timer'}>{busy === 'timer' ? 'Saving…' : timer?.active ? 'Pause my timer' : 'Start my timer'}</button>
        </div>

        <div className="study-progress-strip">
          <span><b>{formatHours(progress?.total_focused_seconds || 0)}</b> member focus</span>
          <span><b>{progress?.sessions || 0}</b> sessions</span>
          <span><b>{progress?.active_members || 0}</b> active now</span>
          <span><b>{progress?.completed || 0}</b> completed</span>
        </div>

        <h3 className="study-subhead">Contributions</h3>
        <div className="room-leaderboard">
          {leaderboard.length ? leaderboard.map(row => <div className={`room-leader-row ${row.me ? 'is-me' : ''}`} key={row.user_id}>
            <span className="room-rank">{row.rank}</span>
            <Avatar name={row.name} image={row.profile_image}/>
            <div className="room-leader-copy">
              <div><b>{row.name}{row.me ? ' · You' : ''}</b><small>{formatHours(row.study_seconds)}{row.active ? ' · studying now' : ''}</small></div>
              <i><span style={{ width: `${Math.max(3, (row.study_seconds / maxMemberSeconds) * 100)}%` }}/></i>
            </div>
          </div>) : <div className="empty-state"><p>Focus time appears here as members study.</p></div>}
        </div>
      </section>

      <section className="dash-panel study-conversation">
        <div className="study-members"><b>Members</b>{members.map(member => <span key={member.id} className={member.online ? 'online' : ''}><i/>{member.name}{member.role === 'owner' ? ' · owner' : ''}{member.online ? ' · here' : ''}</span>)}</div>
        <h3 className="study-subhead">Room chat</h3>
        <div className="study-messages" aria-live="polite">
          {messages.length ? messages.map(item => <article key={item.id}><b>{item.name}</b><small>{formatDateTime(item.created_at)}</small><p>{item.content}</p></article>) : <div className="empty-state"><p>Say hello and share what you’re studying.</p></div>}
        </div>
        <form className="community-form" onSubmit={sendMessage}>
          <input value={message} maxLength="2000" onChange={event => setMessage(event.target.value)} placeholder="Write a message…" aria-label="Room message"/>
          <button className="button small" disabled={!message.trim() || busy === 'message'}>Send</button>
        </form>
      </section>

      <aside className="dash-panel study-history">
        <span className="eyebrow">ROOM ACTIVITY</span>
        <h2>What happened here</h2>
        {events.length ? <ol className="study-events">{events.map(item => <li key={item.id}>
          <b>{eventLabels[item.type] || item.type}</b>
          <small>{item.detail}{item.name ? ` · ${item.name}` : ''} · {formatDateTime(item.created_at)}</small>
        </li>)}</ol> : <p className="study-events-empty">Activity will appear as members join, study and chat.</p>}
        {room.owner
          ? <button className="text-button danger" type="button" disabled={busy === 'delete'} onClick={deleteRoom}>Delete room</button>
          : <button className="text-button" type="button" disabled={busy === 'leave'} onClick={leaveRoom}>{busy === 'leave' ? 'Leaving…' : 'Leave room'}</button>}
      </aside>
    </div>
  </>;
}

export default function StudyPage({ api, user }) {
  const location = useLocation(), navigate = useNavigate();
  const roomId = useMemo(() => {
    if (!location.pathname.startsWith('/dashboard/study/')) return '';
    try { return decodeURIComponent(location.pathname.slice('/dashboard/study/'.length)); } catch { return ''; }
  }, [location.pathname]);
  return <DashboardShell user={user}>
    <div className="dash wrap community-page study-page">
      {!roomId && <><span className="eyebrow">FOCUS TOGETHER</span>
      <h1>Study rooms that keep you honest.</h1>
      <p>Share a room with friends or the community, run a shared Pomodoro, track each person’s focus time and keep the conversation in one place.</p></>}
      {roomId ? <StudyRoomView api={api} roomId={roomId} navigate={navigate}/> : <StudyHub api={api} navigate={navigate}/>}
    </div>
  </DashboardShell>;
}
