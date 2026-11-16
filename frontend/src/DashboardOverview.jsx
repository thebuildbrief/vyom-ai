import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

export default function DashboardOverview({ api }) {
  const [coding, setCoding] = useState(null);
  const [codingError, setCodingError] = useState('');
  const [ranking, setRanking] = useState(null);
  const [rankingError, setRankingError] = useState('');
  const [rooms, setRooms] = useState(null);
  const [roomsError, setRoomsError] = useState('');

  useEffect(() => {
    let active = true;
    api('/coding/progress')
      .then(data => { if (active) setCoding(data); })
      .catch(error => { if (active) setCodingError(error.message); });
    api('/leaderboard?scope=global&period=all')
      .then(data => { if (active) setRanking(data.leaderboard?.find(row => row.me) || null); })
      .catch(error => { if (active) setRankingError(error.message); });
    api('/study-rooms')
      .then(data => { if (active) setRooms(data.rooms || []); })
      .catch(error => { if (active) setRoomsError(error.message); });
    return () => { active = false; };
  }, [api]);

  const stats = coding?.stats || {};
  const codingPercent = stats.total_problems
    ? Math.min(100, (stats.solved / stats.total_problems) * 100)
    : 0;

  return <div className="dash-columns">
    <section className="dash-panel">
      <div className="panel-heading">
        <div><span className="eyebrow">YOUR PROGRESS</span><h2>Coding & ranking</h2></div>
      </div>
      {codingError
        ? <p className="form-error" role="alert">{codingError}</p>
        : !coding
          ? <p role="status">Loading coding progress…</p>
          : <div className="history-row">
            <div>
              <b>{stats.solved || 0}/{stats.total_problems || 0} coding problems solved</b>
              <small>{stats.submissions || 0} runs and submissions · {stats.passed_tests || 0}/{stats.total_tests || 0} verified tests passed</small>
              <div className="coding-progress-bar"><i style={{ width: `${codingPercent}%` }}/></div>
            </div>
            <Link to="/dashboard/coding">Code Lab →</Link>
          </div>}
      {rankingError
        ? <p className="form-error" role="alert">{rankingError}</p>
        : !ranking
          ? <div className="empty-state"><p>Your global ranking will appear after your first activity.</p></div>
          : <div className="history-row">
            <div><b>Global rank #{ranking.rank} · {Number(ranking.points).toLocaleString()} points</b><small>{ranking.completed_interviews} completed interviews · {ranking.average_score == null ? 'No report score yet' : `${ranking.average_score}% average`}</small></div>
            <Link to="/dashboard/friends">Leaderboard →</Link>
          </div>}
    </section>
    <section className="dash-panel">
      <div className="panel-heading">
        <div><span className="eyebrow">FOCUS TOGETHER</span><h2>Study rooms</h2></div>
        <Link to="/dashboard/study">Open →</Link>
      </div>
      {roomsError
        ? <p className="form-error" role="alert">{roomsError}</p>
        : !rooms
          ? <p role="status">Loading your study rooms…</p>
          : rooms.length
            ? rooms.slice(0, 4).map(room => <div className="history-row" key={room.id}>
              <div><b>{room.name}</b><small>{room.member_count} members · invite {room.join_code}</small></div>
              <Link to={`/dashboard/study/${encodeURIComponent(room.id)}`}>Open →</Link>
            </div>)
            : <div className="empty-state"><p>No study rooms yet. Create one or join a friend’s room.</p><Link to="/dashboard/study">Find a study room →</Link></div>}
    </section>
  </div>;
}
