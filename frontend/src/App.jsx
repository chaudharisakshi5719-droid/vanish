import React, { useEffect, useState } from 'react'

const getApiBase = () => {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL
  if (typeof window !== 'undefined' && window.location.hostname && window.location.hostname !== 'localhost') {
    return `http://${window.location.hostname}:8000`
  }
  return 'http://localhost:8000'
}
const API = getApiBase()
const emptyAuth = {name:'', email:'', password:'', company_name:'', invitation_code:'', job_title:'General'}

function formatDateTime(isoStr) {
  if (!isoStr) return '—'
  const d = new Date(isoStr)
  if (isNaN(d.getTime())) return isoStr
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  })
}

function formatDuration(loginIso, logoutIso) {
  if (!loginIso) return '—'
  const start = new Date(loginIso).getTime()
  const end = logoutIso ? new Date(logoutIso).getTime() : Date.now()
  if (isNaN(start) || isNaN(end)) return '—'
  const diffSec = Math.max(0, Math.floor((end - start) / 1000))
  const hours = Math.floor(diffSec / 3600)
  const minutes = Math.floor((diffSec % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m`
  return '< 1m'
}

export default function App() {
  const [token, setToken] = useState(sessionStorage.getItem('vanish_token') || '')
  const [sessionId, setSessionId] = useState(sessionStorage.getItem('vanish_session_id') || '')
  const [user, setUser] = useState(null)
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState(emptyAuth)
  const [employees, setEmployees] = useState([])
  const [handovers, setHandovers] = useState([])
  const [knowledge, setKnowledge] = useState([])
  const [activities, setActivities] = useState([])
  const [activitySearch, setActivitySearch] = useState('')
  const [activityFilter, setActivityFilter] = useState('all')
  const [notifications, setNotifications] = useState([])
  const [notifFilter, setNotifFilter] = useState('all')
  const [invite, setInvite] = useState(null)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  // Clear any legacy cross-tab localStorage token
  useEffect(() => {
    try { localStorage.removeItem('vanish_token') } catch (e) {}
  }, [])

  const api = async (path, options={}) => {
    try {
      const res = await fetch(`${API}${path}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? {Authorization: `Bearer ${token}`} : {}),
          ...(options.headers || {})
        }
      })
      const data = await res.json().catch(() => ({detail: 'Unexpected server response'}))
      if (!res.ok) throw new Error(data.detail || 'Something went wrong')
      return data
    } catch (err) {
      if (err.name === 'TypeError' && err.message.toLowerCase().includes('fetch')) {
        throw new Error(`Unable to connect to server at ${API}. Please verify the backend is running.`)
      }
      throw err
    }
  }

  const change = (e) => setForm({...form, [e.target.name]: e.target.value})
  const switchMode = (newMode) => { setMode(newMode); setNotice(''); setForm(emptyAuth); }

  const saveSession = (data) => {
    sessionStorage.setItem('vanish_token', data.access_token)
    if (data.session_id) {
      sessionStorage.setItem('vanish_session_id', data.session_id)
      setSessionId(data.session_id)
    }
    try { localStorage.removeItem('vanish_token') } catch (e) {}
    setToken(data.access_token)
    setUser(data.user)
    setNotice('Welcome to Vanish.')
  }

  const logout = async (reason = 'Manual sign out') => {
    try {
      const curSid = sessionId || sessionStorage.getItem('vanish_session_id')
      if (token && curSid) {
        await api('/auth/logout', {
          method: 'POST',
          body: JSON.stringify({ session_id: curSid, reason })
        }).catch(() => {})
      }
    } catch (e) {}
    sessionStorage.removeItem('vanish_token')
    sessionStorage.removeItem('vanish_session_id')
    try { localStorage.removeItem('vanish_token') } catch (e) {}
    setToken('')
    setSessionId('')
    setUser(null)
    setInvite(null)
    setMode('login')
    setNotice('')
  }

  const refresh = async () => {
    try {
      const me = await api('/auth/me')
      setUser(me)
      try {
        const [hs, ks, notifs] = await Promise.all([
          api('/handovers'),
          api('/knowledge'),
          api('/notifications').catch(() => [])
        ])
        setHandovers(hs)
        setKnowledge(ks)
        setNotifications(notifs || [])
        if (me.role === 'manager') {
          const [emps, acts] = await Promise.all([api('/employees'), api('/activity')])
          setEmployees(emps)
          setActivities(acts)
        }
      } catch (dataErr) {
        console.warn('Auxiliary data refresh failed:', dataErr)
      }
    } catch (authErr) {
      console.warn('Session invalid, logging out:', authErr)
      logout()
    }
  }

  const refreshActivitiesOnly = async () => {
    try {
      const acts = await api('/activity')
      setActivities(acts)
      setNotice('Activity dashboard updated.')
    } catch (err) {
      setNotice(err.message)
    }
  }

  const refreshNotificationsOnly = async () => {
    try {
      const notifs = await api('/notifications')
      setNotifications(notifs)
      setNotice('Notifications refreshed.')
    } catch (err) {
      setNotice(err.message)
    }
  }

  // Periodic polling for notifications and active statuses every 6s
  useEffect(() => {
    if (!token) return
    const interval = setInterval(() => {
      api('/notifications').then(data => setNotifications(data)).catch(() => {})
      if (user?.role === 'manager') {
        api('/activity').then(acts => setActivities(acts)).catch(() => {})
      }
    }, 6000)
    return () => clearInterval(interval)
  }, [token, user?.role])

  const acceptNotification = async (notifId) => {
    try {
      setBusy(true)
      const updated = await api(`/notifications/${notifId}/accept`, { method: 'POST' })
      setNotifications(prev => prev.map(n => n.id === notifId ? updated : n))
      setNotice('✓ You accepted and claimed this work handover! The takeover option is now locked.')
      await refresh()
    } catch (err) {
      setNotice(err.message)
      await refreshNotificationsOnly()
    } finally {
      setBusy(false)
    }
  }

  const denyNotification = async (notifId) => {
    try {
      setBusy(true)
      const updated = await api(`/notifications/${notifId}/deny`, { method: 'POST' })
      setNotifications(prev => prev.map(n => n.id === notifId ? updated : n))
      setNotice('You declined to take over this work handover.')
    } catch (err) {
      setNotice(err.message)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (token) refresh()
  }, [token])

  // Beacon for browser close detection
  useEffect(() => {
    const handlePageHide = () => {
      const curSid = sessionId || sessionStorage.getItem('vanish_session_id')
      if (curSid && navigator.sendBeacon) {
        const payload = JSON.stringify({ session_id: curSid, reason: 'Browser window closed' })
        const blob = new Blob([payload], { type: 'application/json' })
        navigator.sendBeacon(`${API}/auth/logout-beacon`, blob)
      }
    }
    window.addEventListener('pagehide', handlePageHide)
    return () => window.removeEventListener('pagehide', handlePageHide)
  }, [sessionId])

  // Check if current employee has a pending or changes_requested handover to complete
  const hasPendingHandover = Boolean(
    user?.role === 'employee' &&
    handovers.some(h => ['pending', 'changes_requested'].includes(h.status))
  )

  // Prevent closing tab or browser if employee has not completed handover
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (hasPendingHandover) {
        e.preventDefault()
        e.returnValue = 'You have not submitted your work handover yet. Please answer all 3 questions before leaving.'
        return e.returnValue
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasPendingHandover])

  const handleLogout = () => {
    if (hasPendingHandover) {
      setNotice('🔒 Exit blocked: As a leaving employee, you must answer and submit all 3 handover questions before you can log out.')
      const el = document.getElementById('handovers')
      if (el) el.scrollIntoView({ behavior: 'smooth' })
      return
    }
    logout('Manual sign out')
  }

  const submitAuth = async (e) => {
    e.preventDefault()
    setBusy(true)
    setNotice('')
    try {
      let data
      if (mode === 'register') {
        data = await api('/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            company_name: form.company_name.trim(),
            name: form.name.trim(),
            email: form.email.trim(),
            password: form.password
          })
        })
      } else if (mode === 'join') {
        data = await api('/auth/join', {
          method: 'POST',
          body: JSON.stringify({
            invitation_code: form.invitation_code.trim(),
            name: form.name.trim(),
            email: form.email.trim(),
            password: form.password
          })
        })
      } else {
        data = await api('/auth/login', {
          method: 'POST',
          body: JSON.stringify({
            email: form.email.trim(),
            password: form.password
          })
        })
      }
      saveSession(data)
    } catch (err) {
      setNotice(err.message)
    } finally {
      setBusy(false)
    }
  }

  const createInvite = async (e) => {
    e.preventDefault()
    try {
      const result = await api('/invitations', {
        method: 'POST',
        body: JSON.stringify({email: form.email || null, job_title: form.job_title})
      })
      setInvite(result)
      setNotice('Invitation created. Share this code securely.')
    } catch (err) {
      setNotice(err.message)
    }
  }

  const copyCode = (code) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }).catch(() => fallbackCopy(code))
    } else {
      fallbackCopy(code)
    }
  }

  const fallbackCopy = (text) => {
    const el = document.createElement('textarea')
    el.value = text
    document.body.appendChild(el)
    el.select()
    try {
      document.execCommand('copy')
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (e) {}
    document.body.removeChild(el)
  }

  const createHandover = async (employee_id) => {
    try {
      await api('/handovers', {
        method: 'POST',
        body: JSON.stringify(employee_id ? {employee_id} : {})
      })
      setNotice('Work handover initiated. 3 role-specific questions are ready.')
      await refresh()
    } catch (err) {
      setNotice(err.message)
    }
  }

  const submitAnswers = async (h, answers) => {
    try {
      setBusy(true)
      await api(`/handovers/${h.id}/answers`, {
        method: 'PUT',
        body: JSON.stringify({answers})
      })
      setNotice('✅ Your handover answers have been submitted for review! Logging you out now. Thank you for your work.')
      // Auto logout employee once handover is completed
      setTimeout(() => {
        logout('Handover completed & auto-logged out')
      }, 2000)
    } catch (err) {
      setNotice(err.message)
    } finally {
      setBusy(false)
    }
  }

  const review = async (id, action) => {
    try {
      await api(`/handovers/${id}/review`, {
        method: 'POST',
        body: JSON.stringify({action})
      })
      setNotice(action === 'approve' ? 'Handover approved and added to the Knowledge Library.' : 'Changes requested.')
      await refresh()
    } catch (err) {
      setNotice(err.message)
    }
  }

  // Filter activities for dashboard
  const filteredActivities = activities.filter(a => {
    if (activityFilter === 'active' && !a.is_active) return false
    if (activityFilter === 'ended' && a.is_active) return false
    if (activitySearch.trim()) {
      const q = activitySearch.toLowerCase()
      const matchName = a.employee_name?.toLowerCase().includes(q)
      const matchEmail = a.employee_email?.toLowerCase().includes(q)
      const matchTitle = a.job_title?.toLowerCase().includes(q)
      if (!matchName && !matchEmail && !matchTitle) return false
    }
    return true
  })

  const onlineCount = activities.filter(a => a.is_active && a.role === 'employee').length
  const totalSessionsCount = activities.length
  const openNotifsCount = notifications.filter(n => n.status === 'open' && !n.is_denied_by_me).length

  const filteredNotifications = notifications.filter(n => {
    if (notifFilter === 'open') return n.status === 'open'
    if (notifFilter === 'claimed') return n.status === 'claimed'
    if (notifFilter === 'mine') return n.is_claimed_by_me
    return true
  })

  if (!token || !user) {
    return (
      <main className="auth-shell">
        <div className="brand"><span className="brand-mark">v.</span><span>vanish</span></div>
        <section className="auth-card">
          <div className="eyebrow">KNOWLEDGE THAT STAYS</div>
          <h1>{mode === 'register' ? 'Create your company workspace' : mode === 'join' ? 'Join your team' : 'Welcome back'}</h1>
          <p className="muted">{mode === 'register' ? 'Start a private space for your company.' : mode === 'join' ? 'Use the invitation code shared by your manager.' : 'Sign in to continue your handover work.'}</p>
          <form onSubmit={submitAuth}>
            {mode === 'register' && <Field label="Company name" name="company_name" value={form.company_name} onChange={change} required />}
            {mode !== 'login' && <Field label="Your name" name="name" value={form.name} onChange={change} required />}
            {mode === 'join' && <Field label="Invitation code" name="invitation_code" value={form.invitation_code} onChange={change} required />}
            <Field label="Work email" name="email" type="email" value={form.email} onChange={change} required />
            <Field label="Password (8+ characters)" name="password" type="password" value={form.password} onChange={change} required />
            <button type="submit" className="primary wide" disabled={busy}>
              {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : mode === 'join' ? 'Join workspace' : 'Create workspace'}
            </button>
          </form>
          <div className="auth-links">
            {mode !== 'login' && <button type="button" onClick={() => switchMode('login')}>Already have an account? Sign in</button>}
            {mode === 'login' && (
              <>
                <button type="button" onClick={() => switchMode('register')}>Create a company workspace</button>
                <button type="button" onClick={() => switchMode('join')}>Join with an invitation</button>
              </>
            )}
          </div>
          {notice && <p className="notice">{notice}</p>}
        </section>
        <p className="footnote">Private by company. Built for better handovers.</p>
      </main>
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">v.</span><span>vanish</span></div>
        <div className="workspace">
          <span className="workspace-dot"></span>
          <div><b>{user.company_name}</b><small>Private workspace</small></div>
        </div>
        <nav>
          <span className="nav-label">WORKSPACE</span>
          <a className="active" href="#overview">▦ &nbsp; Overview</a>
          <a href="#notifications" style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
            <span>🔔 &nbsp; Notifications</span>
            {openNotifsCount > 0 && <span className="nav-badge notif">{openNotifsCount}</span>}
          </a>
          <a href="#handovers">↗ &nbsp; Handovers</a>
          <a href="#knowledge">▤ &nbsp; Knowledge library</a>
          {user.role === 'manager' && (
            <>
              <a href="#team">♙ &nbsp; Team</a>
              <a href="#activity" style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
                <span>🕒 &nbsp; Login / Logout Logs</span>
                {onlineCount > 0 && <span className="nav-badge">{onlineCount}</span>}
              </a>
            </>
          )}
        </nav>
        <div className="profile">
          <div className="avatar">{user.name.slice(0,1).toUpperCase()}</div>
          <div className="profile-text">
            <b>{user.name}</b>
            <small>{user.role === 'manager' ? 'Workspace manager' : user.job_title}</small>
          </div>
          <button
            type="button"
            className={`logout ${hasPendingHandover ? 'locked' : ''}`}
            onClick={handleLogout}
            title={hasPendingHandover ? "Complete handover before logging out" : "Sign out"}
          >
            {hasPendingHandover ? '🔒 Complete handover' : '↪ Sign out'}
          </button>
        </div>
      </aside>

      <main className="main" id="overview">
        <header className="topbar">
          <div>
            <div className="eyebrow">YOUR WORKSPACE</div>
            <h1>{user.role === 'manager' ? 'Good work starts with what we keep.' : 'Your knowledge matters.'}</h1>
          </div>
          <div className="secure-pill">● &nbsp; Private workspace</div>
        </header>

        {notice && (
          <div className="notice-banner">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice('')}>×</button>
          </div>
        )}

        {hasPendingHandover && (
          <div className="notice-banner" style={{background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca'}}>
            <span>⚠️ <b>Exit locked:</b> Please answer your 3 handover questions below and click "Submit answers for review". You will be automatically logged out once completed.</span>
          </div>
        )}

        <section className="welcome-card">
          <div>
            <span className="welcome-tag">{user.role === 'manager' ? 'MANAGER SPACE' : 'EMPLOYEE SPACE'}</span>
            <h2>{user.role === 'manager' ? 'Make every handover count.' : 'Leave your work in good hands.'}</h2>
            <p>{user.role === 'manager' ? 'Capture the knowledge behind the work, before it walks out the door.' : 'Answer 3 thoughtful questions about your work so your team can keep moving confidently.'}</p>
          </div>
          <div className="welcome-art">✳</div>
        </section>

        <div className="stats">
          <Stat number={openNotifsCount} label="Open Work Alerts" />
          <Stat number={handovers.length} label="Handovers" />
          <Stat number={handovers.filter(h => h.status === 'submitted').length} label="Awaiting review" />
          <Stat number={knowledge.length} label="Knowledge saved" />
          {user.role === 'manager' && (
            <Stat number={onlineCount} label="Employees online now" />
          )}
        </div>

        {user.role === 'manager' && (
          <section className="panel" id="activity">
            <div className="section-head">
              <div>
                <div className="eyebrow">REAL-TIME ATTENDANCE & LOGS</div>
                <h2>Employee Login / Logout Dashboard</h2>
              </div>
              <button
                type="button"
                className="secondary"
                onClick={refreshActivitiesOnly}
                style={{display:'inline-flex', alignItems:'center', gap:'6px'}}
              >
                ⟳ Refresh logs
              </button>
            </div>

            <div className="activity-stats">
              <Stat number={onlineCount} label="🟢 Currently logged in" />
              <Stat number={totalSessionsCount} label="Total session logs" />
              <Stat number={employees.length} label="Monitored employees" />
            </div>

            <div className="filter-row">
              <input
                type="text"
                className="filter-search"
                placeholder="Search employee by name, email, or job role…"
                value={activitySearch}
                onChange={e => setActivitySearch(e.target.value)}
              />
              <select
                className="filter-select"
                value={activityFilter}
                onChange={e => setActivityFilter(e.target.value)}
              >
                <option value="all">All Sessions ({activities.length})</option>
                <option value="active">🟢 Active Now ({activities.filter(a => a.is_active).length})</option>
                <option value="ended">✓ Logged Out ({activities.filter(a => !a.is_active).length})</option>
              </select>
            </div>

            <div className="table-wrap">
              <table className="activity-table">
                <thead>
                  <tr>
                    <th>EMPLOYEE</th>
                    <th>LOGGED IN AT</th>
                    <th>LOGGED OUT AT</th>
                    <th>SESSION DURATION</th>
                    <th>STATUS / EXIT NOTE</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredActivities.map(act => (
                    <tr key={act.id}>
                      <td>
                        <div className="user-cell">
                          <div className="avatar soft">{act.employee_name?.slice(0,1)}</div>
                          <div>
                            <b>{act.employee_name}</b>
                            <small style={{display:'block', color:'#6b7280'}}>{act.employee_email}</small>
                            <span className="role-chip">{act.job_title}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <strong>{formatDateTime(act.login_at)}</strong>
                        <span className="time-sub">{act.device_info}</span>
                      </td>
                      <td>
                        {act.is_active ? (
                          <span className="live-pill">
                            <span className="live-dot"></span> Active now
                          </span>
                        ) : (
                          <div>
                            <strong>{formatDateTime(act.logout_at)}</strong>
                          </div>
                        )}
                      </td>
                      <td>
                        <strong>{formatDuration(act.login_at, act.logout_at)}</strong>
                        <span className="time-sub">{act.is_active ? 'ongoing' : 'completed'}</span>
                      </td>
                      <td>
                        <span className={act.is_active ? 'live-pill' : 'ended-pill'}>
                          {act.logout_reason || (act.is_active ? 'In session' : 'Signed out')}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {!filteredActivities.length && (
                    <tr>
                      <td colSpan={5} style={{textAlign:'center', padding:'30px', color:'#6b7280'}}>
                        No activity records matching your filter. Employee login and logout events will automatically appear here.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {user.role === 'manager' && (
          <section className="panel" id="team">
            <div className="section-head">
              <div><div className="eyebrow">YOUR PEOPLE</div><h2>Team</h2></div>
              <span className="count">{employees.length} employees</span>
            </div>
            <form className="invite-form" onSubmit={createInvite}>
              <Field label="Employee email (optional)" name="email" type="email" value={form.email} onChange={change} />
              <Field label="Job title / role" name="job_title" value={form.job_title} onChange={change} />
              <button type="submit" className="primary">＋ Create invitation</button>
            </form>
            {invite && (
              <div className="invite-code">
                <div>
                  <small>SHARE THIS INVITATION CODE</small>
                  <strong>{invite.code}</strong>
                </div>
                <button type="button" className="secondary" onClick={() => copyCode(invite.code)}>
                  {copied ? '✓ Copied!' : 'Copy code'}
                </button>
              </div>
            )}
            <div className="employee-list">
              {employees.map(emp => (
                <div className="employee-row" key={emp.id}>
                  <div className="avatar soft">{emp.name.slice(0,1)}</div>
                  <div className="employee-info">
                    <b>{emp.name}</b>
                    <small>{emp.email} · {emp.job_title}</small>
                  </div>
                  <button type="button" className="secondary" onClick={() => createHandover(emp.id)}>
                    ＋ Start handover
                  </button>
                </div>
              ))}
              {!employees.length && (
                <p className="empty">No employees yet. Create an invitation above to bring your team in.</p>
              )}
            </div>
          </section>
        )}

        <section className="panel" id="notifications">
          <div className="section-head">
            <div>
              <div className="eyebrow">TEAM WORK NOTIFICATIONS</div>
              <h2>Work Takeover & Departure Alerts</h2>
            </div>
            <button
              type="button"
              className="secondary"
              onClick={refreshNotificationsOnly}
              style={{display:'inline-flex', alignItems:'center', gap:'6px'}}
            >
              ⟳ Refresh notifications
            </button>
          </div>

          <p className="muted" style={{marginBottom:'16px'}}>
            Live alerts when team members log out or submit work handovers. Any team member can take over the pending work by clicking Accept. Once accepted, the work is locked to that person and disabled for all other employees.
          </p>

          <div className="filter-row">
            <select
              className="filter-select"
              value={notifFilter}
              onChange={e => setNotifFilter(e.target.value)}
              style={{minWidth:'240px'}}
            >
              <option value="all">All Notifications ({notifications.length})</option>
              <option value="open">⚡ Open for Takeover ({notifications.filter(n => n.status === 'open').length})</option>
              <option value="claimed">✓ Claimed Work ({notifications.filter(n => n.status === 'claimed').length})</option>
              <option value="mine">★ Claimed by Me ({notifications.filter(n => n.is_claimed_by_me).length})</option>
            </select>
          </div>

          <div className="notification-list">
            {filteredNotifications.map(n => (
              <article key={n.id} className="notification-card">
                <div className="notif-header">
                  <div>
                    <span className={`notif-tag ${n.type}`}>{n.type.replace('_', ' ').toUpperCase()}</span>
                    <h3 className="notif-title">{n.title}</h3>
                  </div>
                  <span className="time-pill">{formatDateTime(n.created_at)}</span>
                </div>

                <p className="notif-message">{n.message}</p>

                {n.handover_answers && n.handover_answers.length > 0 && (
                  <div style={{background:'#f9fafb', border:'1px solid #e5e7eb', borderRadius:'8px', padding:'14px', margin:'12px 0'}}>
                    <b style={{fontSize:'12px', textTransform:'uppercase', letterSpacing:'0.05em', color:'#4b5563', display:'block', marginBottom:'8px'}}>
                      3 Handover Questions Answered by {n.sender_name}:
                    </b>
                    {n.handover_answers.map((qa, idx) => (
                      <div key={idx} style={{marginBottom:'10px'}}>
                        <small style={{fontWeight:600, color:'#374151', display:'block'}}>{qa.prompt}</small>
                        <span style={{fontSize:'13px', color:'#111827', whiteSpace:'pre-wrap'}}>{qa.answer || '—'}</span>
                      </div>
                    ))}
                  </div>
                )}

                {n.is_claimed_by_me && (
                  <div className="claimed-banner mine">
                    ✓ You accepted and took over this work on {formatDateTime(n.claimed_at)}. Responsibilities are assigned to you.
                  </div>
                )}

                {n.status === 'claimed' && !n.is_claimed_by_me && (
                  <div className="claimed-banner other">
                    🔒 Accepted & claimed by <b>{n.claimed_by_name}</b> on {formatDateTime(n.claimed_at)}. Accept option is closed for all other employees.
                  </div>
                )}

                {n.is_denied_by_me && n.status === 'open' && (
                  <div className="claimed-banner denied">
                    You declined to take over this work. Other employees can still accept.
                  </div>
                )}

                {n.can_accept && (
                  <div className="notif-actions">
                    <button
                      type="button"
                      className="primary"
                      onClick={() => acceptNotification(n.id)}
                      disabled={busy}
                    >
                      ✓ Accept & Take Over Work
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => denyNotification(n.id)}
                      disabled={busy}
                    >
                      ✕ Deny
                    </button>
                  </div>
                )}
              </article>
            ))}

            {!filteredNotifications.length && (
              <p className="empty">No notifications yet. Team exit alerts and handover work will appear here automatically.</p>
            )}
          </div>
        </section>

        <section className="panel" id="handovers">
          <div className="section-head">
            <div>
              <div className="eyebrow">KNOWLEDGE TRANSFER</div>
              <h2>{user.role === 'manager' ? 'Handover activity' : 'My work handover'}</h2>
            </div>
          </div>
          <div className="handover-list">
            {handovers.map(h => (
              <HandoverCard
                key={h.id}
                h={h}
                manager={user.role === 'manager'}
                onReview={review}
                onSubmit={submitAnswers}
                busy={busy}
              />
            ))}
            {!handovers.length && (
              <div className="empty">
                {user.role === 'manager' ? (
                  'Start a handover from the Team section when an employee is leaving.'
                ) : (
                  <div>
                    <p>Leaving the team or transitioning roles? Answer 3 work-related questions so your team has everything they need.</p>
                    <button type="button" className="primary" style={{marginTop: '12px'}} onClick={() => createHandover()}>
                      ＋ Start my work handover (3 questions)
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        <section className="panel" id="knowledge">
          <div className="section-head">
            <div><div className="eyebrow">COMPANY MEMORY</div><h2>Knowledge library</h2></div>
            <span className="count">{knowledge.length} approved items</span>
          </div>
          <div className="knowledge-grid">
            {knowledge.map(k => (
              <article className="knowledge-card" key={k.id}>
                <span className="welcome-tag">APPROVED HANDOVER</span>
                <h3>{k.title}</h3>
                <p className="muted">Shared by {k.employee_name}</p>
                <pre>{k.content}</pre>
              </article>
            ))}
            {!knowledge.length && (
              <p className="empty">Approved handovers will become searchable company knowledge here.</p>
            )}
          </div>
        </section>

        <footer>Vanish · Keep the knowledge. Respect the people.</footer>
      </main>
    </div>
  )
}

function Field({label, name, value, onChange, type='text', required=false}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input name={name} type={type} value={value} onChange={onChange} required={required} />
    </label>
  )
}

function Stat({number, label}) {
  return (
    <div className="stat">
      <strong>{number}</strong>
      <span>{label}</span>
    </div>
  )
}

function HandoverCard({h, manager, onReview, onSubmit, busy}) {
  const [answers, setAnswers] = useState(h.questions.map(q => q.answer || ''))
  const editable = !manager && ['pending', 'changes_requested'].includes(h.status)
  const status = {
    'pending': 'Waiting for employee',
    'submitted': 'Ready for review',
    'changes_requested': 'Changes requested',
    'approved': 'Approved'
  }[h.status] || h.status

  return (
    <article className="handover-card">
      <div className="handover-top">
        <div>
          <h3>{manager ? `${h.employee_name}'s Handover` : 'Your Work Handover (3 Questions)'}</h3>
          <p>{manager ? `${h.job_title} · 3 role-specific questions` : 'Please answer all 3 questions below. Submitting will save your knowledge and log you out.'}</p>
        </div>
        <span className={`status ${h.status}`}>{status}</span>
      </div>

      {h.questions.map((q, i) => (
        <div className="question" key={q.id}>
          <label>{i+1}. {q.prompt}</label>
          {editable ? (
            <textarea
              value={answers[i]}
              onChange={e => setAnswers(answers.map((a, j) => j === i ? e.target.value : a))}
              placeholder="Add useful context, steps, links, and things to watch out for…"
              rows={4}
            />
          ) : (
            <div className="answer">{q.answer || 'Not answered yet.'}</div>
          )}
        </div>
      ))}

      {editable && (
        <button
          type="button"
          className="primary wide"
          onClick={() => onSubmit(h, answers)}
          disabled={busy || answers.some(a => !a.trim())}
        >
          {busy ? 'Submitting & logging out…' : 'Submit all 3 answers & complete exit'}
        </button>
      )}

      {manager && h.status === 'submitted' && (
        <div className="review-actions">
          <button type="button" className="secondary" onClick={() => onReview(h.id, 'request_changes')}>
            Request changes
          </button>
          <button type="button" className="primary" onClick={() => onReview(h.id, 'approve')}>
            ✓ Approve & save knowledge
          </button>
        </div>
      )}
    </article>
  )
}
