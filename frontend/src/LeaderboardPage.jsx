import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDateTime } from './dates.js';
import DashboardShell, { Avatar } from './DashboardShell.jsx';

function formatHours(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  if (value < 60) return '0m';
  if (value < 3600) return `${Math.floor(value / 60)}m`;
  return `${(value / 3600).toFixed(1)}h`;
}

function BadgePills({ ids, catalog, limit = 4 }) {
  if (!ids?.length) return null;
  const byId = new Map((catalog || []).map(badge => [badge.id, badge]));
  return <span className="lb-badges">{ids.slice(0, limit).map(id => {
    const badge = byId.get(id);
    return <span className="lb-badge" key={id} title={badge ? `${badge.name} — ${badge.description}` : id}>{badge?.symbol || '✦'}</span>;
  })}{ids.length > limit && <span className="lb-badge more">+{ids.length - limit}</span>}</span>;
}

function LeaderboardPanel({ api, refreshKey }) {
  const [scope, setScope] = useState('global');
  const [period, setPeriod] = useState('all');
  const [board, setBoard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    api(`/leaderboard?scope=${scope}&period=${period}`)
      .then(data => { if (alive) setBoard(data); })
      .catch(value => { if (alive) setError(value.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [api, scope, period, refreshKey]);

  const rows = board?.leaderboard || [], me = board?.me, catalog = board?.badge_catalog || [];
  const podium = rows.filter(row => row.rank <= 3 && (!me || row.id !== me.id || row.rank <= 3)).slice(0, 3);
  const rest = rows.filter(row => !podium.some(top => top.id === row.id));
  const myBadges = new Set(me?.badges || []);

  return <section className="dash-panel leaderboard-panel">
    <div className="lb-heading">
      <div>
        <span className="eyebrow">REAL ACTIVITY RANKING</span>
        <h2>{scope === 'global' ? 'Global leaderboard' : 'Friends leaderboard'}</h2>
        <p>Points come from completed interviews, report scores, passed coding tests and focused study time. Levels grow with lifetime XP; badges are earned only from verified activity.</p>
      </div>
      <div className="lb-filters">
        <div className="lb-switch" role="group" aria-label="Leaderboard scope">
          <button type="button" aria-pressed={scope === 'global'} onClick={() => setScope('global')}>Global</button>
          <button type="button" aria-pressed={scope === 'friends'} onClick={() => setScope('friends')}>Friends</button>
        </div>
        <div className="lb-switch" role="group" aria-label="Leaderboard period">
          <button type="button" aria-pressed={period === 'all'} onClick={() => setPeriod('all')}>All time</button>
          <button type="button" aria-pressed={period === 'weekly'} onClick={() => setPeriod('weekly')}>This week</button>
        </div>
      </div>
    </div>

    {error && <div className="empty-card" role="alert">{error}</div>}
    {loading && !board ? <div className="lb-loading" role="status">Loading real rankings…</div> : <>
      {me && <section className="lb-me-card" aria-label="Your ranking summary">
        <div className="lb-me-rank"><span>YOUR RANK</span><strong>#{me.rank}</strong><small>of {board?.total || rows.length} {scope === 'friends' ? 'in your circle' : 'practicing'}</small></div>
        <div className="lb-me-main">
          <div className="lb-me-title"><b>Level {me.level} · {me.level_name}</b><span>{Number(me.points).toLocaleString()} pts{period === 'all' ? ` · ${Number(me.weekly_points).toLocaleString()} this week` : ''}</span></div>
          <div className="lb-level-bar" role="img" aria-label={`Level progress ${me.level_progress}%`}><i style={{ width: `${me.level_progress}%` }}/></div>
          <small>{me.next_level_xp == null ? 'Top level reached.' : `${Number(me.xp_to_next).toLocaleString()} XP to level ${me.level + 1}`}{me.next_name ? ` · ${Number(me.points_to_next).toLocaleString()} pts to pass ${me.next_name}` : ' · You are leading this board.'}</small>
        </div>
        <div className="lb-me-stats">
          <span><b>{me.completed_interviews}</b> interviews</span>
          <span><b>{me.coding_solved}</b> solved</span>
          <span><b>{formatHours(me.study_seconds)}</b> study</span>
          <span><b>{myBadges.size}</b> badges</span>
        </div>
      </section>}

      {podium.length > 0 && <div className={`lb-podium ${podium.length === 1 ? 'single' : ''}`}>
        {podium.map(row => <article className={`lb-podium-card rank-${row.rank} ${row.me ? 'is-me' : ''}`} key={row.id}>
          <span className="lb-medal">{row.rank === 1 ? '♛' : row.rank === 2 ? '②' : '③'}</span>
          <Avatar name={row.name} image={row.profile_image} size="large"/>
          <b>{row.name}{row.me ? ' · You' : ''}</b>
          <span className="lb-level-pill">Lv {row.level} · {row.level_name}</span>
          <small>{row.completed_interviews} interviews · {row.average_score == null ? 'no score yet' : `${row.average_score}% avg`}</small>
          <strong>{Number(row.points).toLocaleString()} <small>pts</small></strong>
          <div className="lb-podium-meta"><span>{row.coding_solved} solved</span><span>{formatHours(row.study_seconds)} study</span></div>
          <BadgePills ids={row.badges} catalog={catalog} limit={3}/>
        </article>)}
      </div>}

      <div className="lb-table">
        {rest.map(row => <div className={`lb-row ${row.me ? 'is-me' : ''}`} key={row.id}>
          <span className="lb-rank">{row.rank}</span>
          <Avatar name={row.name} image={row.profile_image}/>
          <div className="lb-person">
            <b>{row.name}{row.me ? ' · You' : ''}</b>
            <small>Lv {row.level} {row.level_name} · {row.completed_interviews} completed · {row.average_score == null ? 'No score yet' : `${row.average_score}% average`}</small>
            <BadgePills ids={row.badges} catalog={catalog}/>
          </div>
          <div className="lb-metrics"><span><b>{row.coding_solved}</b> solved</span><span><b>{row.coding_passed}/{row.coding_total}</b> tests</span><span><b>{formatHours(row.study_seconds)}</b> study</span></div>
          <strong className="lb-points">{Number(row.points).toLocaleString()}<small>pts</small></strong>
        </div>)}
        {!rows.length && <div className="empty-state"><span>✳</span><h3>Your board is warming up.</h3><p>Complete an interview, solve a coding problem, or track focused study time to appear with real activity.</p></div>}
      </div>

      {catalog.length > 0 && <section className="lb-badge-catalog">
        <div className="lb-catalog-head"><b>Badges</b><span>Earned from verified activity only</span></div>
        <div className="lb-catalog-grid">{catalog.map(badge => <div className={`lb-catalog-item ${myBadges.has(badge.id) ? 'earned' : ''}`} key={badge.id}>
          <span className="lb-badge">{badge.symbol}</span>
          <div><b>{badge.name}</b><small>{badge.description}</small></div>
          <span className="lb-catalog-state">{myBadges.has(badge.id) ? 'Earned' : 'Locked'}</span>
        </div>)}</div>
      </section>}

      {rows.length > 0 && <p className="lb-note">{scope === 'friends' ? 'This board includes you and your accepted friends.' : 'Global ranking shows public display names only — email addresses are never exposed.'} Weekly views count the last seven days of activity.</p>}
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

  return <div className="dash-columns community-columns lb-friends">
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

export default function LeaderboardPage({ api, user }) {
  const [version, setVersion] = useState(0);
  return <DashboardShell user={user}>
    <div className="dash wrap community-page leaderboard-page">
      <span className="eyebrow">PRACTICE, TOGETHER</span>
      <h1>Measure what you’ve earned.</h1>
      <p>Every point is backed by a completed interview, a verified code run, or tracked study time. Compare with friends or see where you stand globally.</p>
      <LeaderboardPanel api={api} refreshKey={version}/>
      <FriendsPanel api={api} onChanged={() => setVersion(value => value + 1)}/>
      <div className="account-links"><Link to="/dashboard/study">Study rooms ↗</Link><Link to="/dashboard/resume">Resume library ↗</Link><Link to="/interview/setup">Start an interview ↗</Link></div>
    </div>
  </DashboardShell>;
}
