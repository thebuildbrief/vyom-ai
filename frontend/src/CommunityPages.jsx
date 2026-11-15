import React, { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { formatDateTime } from './dates.js';

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

function Avatar({ name, image, size = '' }) {
  const label = String(name || 'V').trim().slice(0, 2).toUpperCase();
  const [imageFailed, setImageFailed] = useState(false);
  const safeImage = !imageFailed && typeof image === 'string' && /^https?:\/\//i.test(image);
  return <span className={`lb-avatar ${size}`} aria-hidden="true">{safeImage ? <img src={image} alt="" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} /> : label}</span>;
}

function LeaderboardPanel({ api }) {
  const [scope, setScope] = useState('friends');
  const [period, setPeriod] = useState('all');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    api(`/leaderboard?scope=${scope}&period=${period}`)
      .then(data => { if (alive) setRows(data.leaderboard || []); })
      .catch(value => { if (alive) setError(value.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [api, scope, period]);

  const podium = rows.slice(0, 3);
  const rest = rows.slice(3);
  return <section className="dash-panel leaderboard-panel">
    <div className="lb-heading">
      <div>
        <span className="eyebrow">LIVE ACTIVITY RANKING</span>
        <h2>Friends leaderboard</h2>
        <p>Points come from completed interviews, report scores, passed coding tests and focused study time.</p>
      </div>
      <div className="lb-filters">
        <div className="lb-switch" role="group" aria-label="Leaderboard scope">
          <button type="button" aria-pressed={scope === 'friends'} onClick={() => setScope('friends')}>Friends</button>
          <button type="button" aria-pressed={scope === 'global'} onClick={() => setScope('global')}>Global</button>
        </div>
        <div className="lb-switch" role="group" aria-label="Leaderboard period">
          <button type="button" aria-pressed={period === 'all'} onClick={() => setPeriod('all')}>All time</button>
          <button type="button" aria-pressed={period === 'weekly'} onClick={() => setPeriod('weekly')}>This week</button>
        </div>
      </div>
    </div>
    {error && <div className="empty-card" role="alert">{error}</div>}
    {loading ? <div className="lb-loading" role="status">Loading rankings…</div> : <>
      {podium.length > 0 && <div className={`lb-podium ${podium.length === 1 ? 'single' : ''}`}>
        {podium.map(row => <article className={`lb-podium-card rank-${row.rank} ${row.me ? 'is-me' : ''}`} key={row.id}>
          <span className="lb-medal">{row.rank === 1 ? '♛' : row.rank === 2 ? '②' : '③'}</span>
          <Avatar name={row.name} image={row.profile_image} size="large" />
          <b>{row.name}{row.me ? ' · You' : ''}</b>
          <small>{row.completed_interviews} interviews · {row.average_score == null ? 'no score yet' : `${row.average_score}% avg`}</small>
          <strong>{Number(row.points).toLocaleString()} <small>pts</small></strong>
          <div className="lb-podium-meta"><span>{row.coding_solved} solved</span><span>{formatHours(row.study_seconds)} study</span></div>
        </article>)}
      </div>}
      <div className="lb-table">
        {rest.length ? rest.map(row => <div className={`lb-row ${row.me ? 'is-me' : ''}`} key={row.id}>
          <span className="lb-rank">{row.rank}</span>
          <Avatar name={row.name} image={row.profile_image} />
          <div className="lb-person"><b>{row.name}{row.me ? ' · You' : ''}</b><small>{row.completed_interviews} completed · {row.average_score == null ? 'No score yet' : `${row.average_score}% average`}</small></div>
          <div className="lb-metrics"><span><b>{row.coding_solved}</b> solved</span><span><b>{row.coding_passed}/{row.coding_total}</b> tests</span><span><b>{formatHours(row.study_seconds)}</b> study</span></div>
          <strong className="lb-points">{Number(row.points).toLocaleString()}<small>pts</small></strong>
        </div>) : null}
        {!rows.length && <div className="empty-state"><span>✳</span><h3>Your board is warming up.</h3><p>Complete an interview, solve a coding problem, or start a study timer to appear with real activity.</p></div>}
      </div>
      {rows.length > 0 && <p className="lb-note">{scope === 'friends' ? 'This board includes you and your accepted friends.' : 'Global ranking uses public display names only — email addresses are never shown.'} Weekly rankings reset to the last seven days of activity.</p>}
    </>}
  </section>;
}

function FriendsPanel({ api, onChanged }) {
  const [email, setEmail] = useState('');
  const [found, setFound] = useState(null);
  const [friends, setFriends] = useState({ friends: [], requests: [] });
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const data = await api('/friends');
      setFriends({ friends: data.friends || [], requests: data.requests || [] });
    } catch (value) { setError(value.message); }
  }, [api]);

  useEffect(() => { refresh(); }, [refresh]);

  async function run(action) {
    setError('');
    setNotice('');
    try { await action(); } catch (value) { setError(value.message); }
  }

  async function search(event) {
    event.preventDefault();
    await run(async () => {
      const data = await api(`/friends/search?email=${encodeURIComponent(email)}`);
      setFound(data.user);
      if (!data.user) setNotice('No VYOM account was found for that email.');
    });
  }

  async function sendRequest() {
    if (!found) return;
    await run(async () => {
      await api('/friends/requests', { method: 'POST', body: JSON.stringify({ user_id: found.id }) });
      setNotice(`Friend request sent to ${found.name}.`);
      setFound(null);
      setEmail('');
      onChanged?.();
    });
  }

  return <div className="dash-columns community-columns">
    <section className="dash-panel">
      <span className="eyebrow">GROW YOUR CIRCLE</span>
      <h2>Find a friend</h2>
      <p>Search by their exact account email. Email addresses are never shown in the results.</p>
      <form className="community-form" onSubmit={search}>
        <input type="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="friend@example.com" aria-label="Friend email"/>
        <button className="button small">Search</button>
      </form>
      {found && <div className="history-row"><div><b>{found.name}</b><small>Ready to connect</small></div><button className="button small" onClick={sendRequest}>Send request</button></div>}
      {notice && <div className="empty-card" role="status">{notice}</div>}
      {error && <div className="empty-card" role="alert">{error}</div>}
      <h2>Friend requests</h2>
      {friends.requests.length ? friends.requests.map(item => <div className="history-row" key={item.id}>
        <div><b>{item.name}</b><small>Wants to connect</small></div>
        <div className="community-row-actions">
          <button className="button small" onClick={() => run(async () => { await api(`/friends/requests/${item.id}/accept`, { method: 'POST' }); await refresh(); onChanged?.(); })}>Accept</button>
          <button onClick={() => run(async () => { await api(`/friends/${item.id}`, { method: 'DELETE' }); await refresh(); onChanged?.(); })}>Decline</button>
        </div>
      </div>) : <div className="empty-state"><p>No pending requests.</p></div>}
    </section>
    <section className="dash-panel">
      <span className="eyebrow">YOUR CONNECTIONS</span>
      <h2>Your friends</h2>
      <p>Accepted friends appear on your private leaderboard and can share study rooms.</p>
      {friends.friends.length ? friends.friends.map(item => <div className="history-row" key={item.friendship_id}>
        <div><b>{item.name}</b><small>Connected {formatDateTime(item.created_at)}</small></div>
        <button onClick={() => run(async () => { await api(`/friends/${item.friendship_id}`, { method: 'DELETE' }); await refresh(); onChanged?.(); })}>Remove</button>
      </div>) : <div className="empty-state"><p>Your accepted friends will appear here.</p></div>}
    </section>
  </div>;
}

function StudyTab({ api, roomId, navigate }) {
  const [rooms, setRooms] = useState([]);
  const [room, setRoom] = useState(null);
  const [members, setMembers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [timer, setTimer] = useState(null);
  const [roomLeaderboard, setRoomLeaderboard] = useState([]);
  const [roomProgress, setRoomProgress] = useState(null);
  const [timerUpdatedAt, setTimerUpdatedAt] = useState(Date.now());
  const [timerNow, setTimerNow] = useState(Date.now());
  const [timerBusy, setTimerBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const refreshRooms = useCallback(async () => {
    try { setRooms((await api('/study-rooms')).rooms || []); } catch (value) { setError(value.message); }
  }, [api]);

  const refreshRoom = useCallback(async () => {
    if (!roomId) return;
    const data = await api(`/study-rooms/${encodeURIComponent(roomId)}`);
    setRoom(data.room);
    setMembers(data.members || []);
    setMessages(data.messages || []);
    setTimer(data.timer || null);
    setRoomLeaderboard(data.room_leaderboard || []);
    setRoomProgress(data.room_progress || null);
    setTimerUpdatedAt(Date.now());
  }, [api, roomId]);

  useEffect(() => { refreshRooms(); }, [refreshRooms]);
  useEffect(() => {
    if (!roomId) { setRoom(null); setRoomLeaderboard([]); setRoomProgress(null); return; }
    let alive = true;
    const update = () => refreshRoom().catch(value => { if (alive) setError(value.message); });
    update();
    const interval = setInterval(update, 5000);
    return () => { alive = false; clearInterval(interval); };
  }, [roomId, refreshRoom]);
  useEffect(() => {
    if (!roomId || !timer?.active) return;
    let alive = true;
    const heartbeat = async () => { try { await api(`/study-rooms/${encodeURIComponent(roomId)}/timer/heartbeat`, { method: 'POST' }); } catch (value) { if (alive) setError(value.message); } };
    const interval = setInterval(heartbeat, 15000);
    return () => { alive = false; clearInterval(interval); };
  }, [api, roomId, timer?.active]);
  useEffect(() => { const tick = setInterval(() => setTimerNow(Date.now()), 1000); return () => clearInterval(tick); }, []);

  async function run(action) {
    setError('');
    setNotice('');
    try { await action(); } catch (value) { setError(value.message); }
  }

  async function createRoom(event) {
    event.preventDefault();
    await run(async () => {
      const data = await api('/study-rooms', { method: 'POST', body: JSON.stringify({ name }) });
      setName('');
      await refreshRooms();
      navigate(`/dashboard/study/${encodeURIComponent(data.room.id)}`);
    });
  }

  async function joinRoom(event) {
    event.preventDefault();
    await run(async () => {
      const data = await api('/study-rooms/join', { method: 'POST', body: JSON.stringify({ join_code: code }) });
      setCode('');
      await refreshRooms();
      navigate(`/dashboard/study/${encodeURIComponent(data.room.id)}`);
    });
  }

  async function sendMessage(event) {
    event.preventDefault();
    if (!roomId || !message.trim()) return;
    await run(async () => {
      await api(`/study-rooms/${encodeURIComponent(roomId)}/messages`, { method: 'POST', body: JSON.stringify({ content: message }) });
      setMessage('');
      await refreshRoom();
    });
  }

  async function toggleTimer() {
    if (!roomId || timerBusy) return;
    setTimerBusy(true);
    await run(async () => {
      const data = await api(`/study-rooms/${encodeURIComponent(roomId)}/timer/${timer?.active ? 'stop' : 'start'}`, { method: 'POST' });
      setTimer(data.timer || null);
      setTimerUpdatedAt(Date.now());
      await refreshRoom();
      await refreshRooms();
    });
    setTimerBusy(false);
  }

  async function copyCode() {
    if (!room) return;
    try { await navigator.clipboard.writeText(room.join_code); setNotice('Invite code copied. Share it with a friend.'); }
    catch { setNotice(`Invite code: ${room.join_code}`); }
  }

  const ownSeconds = (timer?.individual_seconds || 0) + (timer?.active ? Math.floor((timerNow - timerUpdatedAt) / 1000) : 0);
  const groupSeconds = (timer?.group_seconds || 0) + (timer?.active_members ? Math.floor((timerNow - timerUpdatedAt) / 1000) : 0);
  const maxMemberSeconds = Math.max(1, ...roomLeaderboard.map(row => row.study_seconds));

  return <div className="dash-columns community-columns">
    <section className="dash-panel">
      <span className="eyebrow">FOCUS TOGETHER</span>
      <h2>Your study rooms</h2>
      <p>Create a private room and share its invite code, or join a friend’s room.</p>
      <form className="community-form" onSubmit={createRoom}>
        <input value={name} maxLength="80" required onChange={event => setName(event.target.value)} placeholder="Room name" aria-label="Room name"/>
        <button className="button small">Create room</button>
      </form>
      <form className="community-form" onSubmit={joinRoom}>
        <input value={code} maxLength="10" required onChange={event => setCode(event.target.value)} placeholder="Invite code" aria-label="Invite code"/>
        <button className="button secondary small">Join</button>
      </form>
      {rooms.length ? rooms.map(item => <div className="history-row" key={item.id}>
        <div><b>{item.name}</b><small>{item.member_count} members · invite {item.join_code}</small></div>
        <Link to={`/dashboard/study/${encodeURIComponent(item.id)}`}>Open →</Link>
      </div>) : <div className="empty-state"><p>No rooms yet. Create one or join with an invite code.</p></div>}
    </section>
    {roomId && <section className="dash-panel study-room-panel">
      {!room ? <p role="status">Loading room…</p> : <>
        <div className="study-room-head">
          <div><span className="eyebrow">PRIVATE STUDY ROOM</span><h2>{room.name}</h2></div>
          <button className="study-code" type="button" onClick={copyCode} title="Copy invite code">Invite · {room.join_code}</button>
        </div>
        <div className="study-timers">
          <div><span>Your focused time</span><strong>{formatTimer(ownSeconds)}</strong><small>{timer?.active ? 'Timer running on this account' : 'Paused for this account'}</small></div>
          <div><span>Group focused time</span><strong>{formatTimer(groupSeconds)}</strong><small>{timer?.active_members || 0} member(s) studying now</small></div>
          <button className="button small" onClick={toggleTimer} disabled={timerBusy}>{timerBusy ? 'Saving…' : timer?.active ? 'Pause my timer' : 'Start my timer'}</button>
        </div>
        <div className="study-progress-strip">
          <span><b>{formatHours(roomProgress?.total_focused_seconds || 0)}</b> member focus</span>
          <span><b>{roomProgress?.sessions || 0}</b> sessions</span>
          <span><b>{roomProgress?.active_members || 0}</b> active now</span>
        </div>
        <h3 className="study-subhead">Room leaderboard</h3>
        <div className="room-leaderboard">
          {roomLeaderboard.map(row => <div className={`room-leader-row ${row.me ? 'is-me' : ''}`} key={row.user_id}>
            <span className="room-rank">{row.rank}</span>
            <Avatar name={row.name} image={row.profile_image} />
            <div className="room-leader-copy">
              <div><b>{row.name}{row.me ? ' · You' : ''}</b><small>{formatHours(row.study_seconds)}{row.active ? ' · studying now' : ''}</small></div>
              <i><span style={{ width: `${Math.max(3, (row.study_seconds / maxMemberSeconds) * 100)}%` }}/></i>
            </div>
          </div>)}
        </div>
        <div className="study-members"><b>Members</b>{members.map(member => <span key={member.id}>{member.name}{member.online ? ' · here' : ''}</span>)}</div>
        <h3 className="study-subhead">Room chat</h3>
        <div className="study-messages" aria-live="polite">
          {messages.length ? messages.map(item => <article key={item.id}><b>{item.name}</b><small>{formatDateTime(item.created_at)}</small><p>{item.content}</p></article>) : <div className="empty-state"><p>Say hello and share what you’re studying.</p></div>}
        </div>
        <form className="community-form" onSubmit={sendMessage}>
          <input value={message} maxLength="2000" onChange={event => setMessage(event.target.value)} placeholder="Write a message…" aria-label="Room message"/>
          <button className="button small" disabled={!message.trim()}>Send</button>
        </form>
        {room.owner
          ? <button className="text-button" onClick={() => { if (window.confirm('Delete this study room and its chat history?')) run(async () => { await api(`/study-rooms/${encodeURIComponent(roomId)}`, { method: 'DELETE' }); navigate('/dashboard/study'); }); }}>Delete room</button>
          : <button className="text-button" onClick={() => run(async () => { await api(`/study-rooms/${encodeURIComponent(roomId)}/membership`, { method: 'DELETE' }); navigate('/dashboard/study'); })}>Leave room</button>}
      </>}
    </section>}
    {notice && <div className="empty-card" role="status">{notice}</div>}
    {error && <div className="empty-card" role="alert">{error}</div>}
  </div>;
}

export default function CommunityPage({ api }) {
  const location = useLocation(), navigate = useNavigate();
  let roomId = '';
  if (location.pathname.startsWith('/dashboard/study/')) {
    try { roomId = decodeURIComponent(location.pathname.slice('/dashboard/study/'.length)); } catch { roomId = ''; }
  }
  const tab = location.pathname.includes('friends') ? 'friends' : 'study';
  const [boardVersion, setBoardVersion] = useState(0);

  const chooseTab = value => navigate(value === 'friends' ? '/dashboard/friends' : '/dashboard/study');

  return <div className="dash wrap community-page">
    <span className="eyebrow">PRACTICE, TOGETHER</span>
    <h1>Find your people.</h1>
    <p>Connect with friends, compare real progress, and study together in private rooms. Rankings use completed sessions, verified code runs and tracked focus time.</p>
    <div className="account-links">
      <button onClick={() => chooseTab('friends')} aria-pressed={tab === 'friends'}>Friends & leaderboard</button>
      <button onClick={() => chooseTab('study')} aria-pressed={tab === 'study'}>Study rooms</button>
      <Link to="/dashboard">Back to dashboard ↗</Link>
    </div>
    {tab === 'friends' ? <>
      <LeaderboardPanel api={api} key={boardVersion}/>
      <FriendsPanel api={api} onChanged={() => setBoardVersion(value => value + 1)}/>
    </> : <StudyTab api={api} roomId={roomId} navigate={navigate}/>}
  </div>;
}
