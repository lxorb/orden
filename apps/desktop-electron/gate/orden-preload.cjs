try {
  const set = (key, value) => localStorage.getItem(key) === null && localStorage.setItem(key, value)
  if (localStorage.getItem('orden:theme') === null) {
    localStorage.setItem('orden:theme', 'default')
    localStorage.setItem('orden:theme-moved', 'yes')
  }
  set('orden:renamed', 'told')
  set('orden:setup', '"done"')
  if (localStorage.getItem('orden:crash-reports-told') === null) {
    localStorage.setItem('orden:crash-reports-told', 'true')
    localStorage.setItem('orden:crash-reports', 'false')
  }
} catch {}
