;(function () {
  if (globalThis.__nibPass) return

  const QUIET = 150
  const LONGEST_QUIET = 1000
  const LONGEST_SAID = 60000
  const MOST_FIELDS = 200
  const MOST_FORMS = 32
  const MOST_ROOTS = 500
  const RETRIES = 50
  const RETRY = 200
  const MARK = 16
  const MARK_NAME = 'orden-pass-mark'
  const LEAST_SIDE = 10
  const LEAST_SHOWN = 0.5

  const TEXTISH = new Set(['', 'text', 'email', 'password', 'tel', 'number', 'date', 'month'])
  const SENDS = new Set(['login', 'username', 'password', 'signup', 'change'])
  const IDENTITY = new Set([
    'given-name',
    'additional-name',
    'family-name',
    'name',
    'tel',
    'street-address',
    'address-line2',
    'postal-code',
    'address-level2',
    'address-level1',
    'country',
    'organization',
    'bday',
  ])
  const CARD = new Set(['cc-name', 'cc-number', 'cc-exp', 'cc-exp-month', 'cc-exp-year', 'cc-csc'])

  const AUTOCOMPLETE = {
    username: 'username',
    email: 'email',
    'current-password': 'password',
    'new-password': 'new-password',
    'one-time-code': 'totp',
    'cc-name': 'cc-name',
    'cc-given-name': 'cc-name',
    'cc-family-name': 'cc-name',
    'cc-number': 'cc-number',
    'cc-exp': 'cc-exp',
    'cc-exp-month': 'cc-exp-month',
    'cc-exp-year': 'cc-exp-year',
    'cc-csc': 'cc-csc',
    'given-name': 'given-name',
    'additional-name': 'additional-name',
    'family-name': 'family-name',
    name: 'name',
    tel: 'tel',
    'tel-national': 'tel',
    'tel-local': 'tel',
    'street-address': 'street-address',
    'address-line1': 'street-address',
    'address-line2': 'address-line2',
    'address-line3': 'address-line2',
    'postal-code': 'postal-code',
    'address-level2': 'address-level2',
    'address-level1': 'address-level1',
    country: 'country',
    'country-name': 'country',
    organization: 'organization',
    bday: 'bday',
  }

  const CC_NUMBER =
    /\b(card ?(number|no|num)|cc ?(number|num|no)|ccnum|cardnum|credit ?card|debit ?card|kartennummer|num[ée]ro de (la )?carte|n[uú]mero de (la )?tarjeta|numero (della )?carta|n[uú]mero do cart[aã]o|kaartnummer)(?![a-z0-9])|номер карты|卡号|卡號|カード番号/
  const CC_CSC =
    /\b(cvc2?|cvv2?|csc|cvn|card ?(security|verification) ?(code|number|value)|kartenpr[uü]fnummer|pr[uü]fnummer|cryptogramme|c[oó]digo de seguridad|codice di sicurezza|c[oó]digo de seguran[cç]a)(?![a-z0-9])|安全码|セキュリティコード|код безопасности/
  const CC_EXP_MONTH =
    /\b(exp(iry|iration)? ?(date )?(month|mo|mm)|cc ?exp ?month|ablaufmonat|mois d'expiration|mes de (vencimiento|caducidad|expiraci[oó]n)|mese di scadenza|m[eê]s de validade|vervalmaand)(?![a-z0-9])/
  const CC_EXP_YEAR =
    /\b(exp(iry|iration)? ?(date )?(year|yr|yy|yyyy)|cc ?exp ?year|ablaufjahr|ann[ée]e d'expiration|a[nñ]o de (vencimiento|caducidad|expiraci[oó]n)|anno di scadenza|ano de validade|vervaljaar)(?![a-z0-9])/
  const CC_EXP =
    /\b(exp(iry|iration)?( ?date)?|valid ?(thru|through|until)|mm ?\/ ?(yy|yyyy|jj|aa)|ablauf(datum)?|g[uü]ltig bis|date d'expiration|(fecha de )?(vencimiento|caducidad)|(data di )?scadenza|validade|vervaldatum)(?![a-z0-9])|срок действия|有效期|有効期限/
  const CC_NAME =
    /\b(name ?on ?(the )?card|card ?holder|cardholder|holder ?name|cc ?name|karteninhaber|nom (du|sur la) (titulaire|carte)|titulaire( de la carte)?|titular( de la tarjeta)?|intestatario|nome (no|do) (titular|cart[aã]o)|kaarthouder|naam op (de )?kaart)(?![a-z0-9])|владелец карты|имя на карте|持卡人|カード名義|名義人/
  const TOTP =
    /\b(otp|totp|2fa|mfa|one ?time ?(code|password|pass ?code|pin)?|two ?factor|2 ?step|verification ?code|verify ?code|auth(entication|enticator)? ?code|sms ?code|security ?code|login ?code|passcode|best[aä]tigungscode|sicherheitscode|einmal ?(code|passwort|kennwort)|code de (v[ée]rification|s[ée]curit[ée]|confirmation)|c[oó]digo de (verificaci[oó]n|seguridad|confirmaci[oó]n|verifica[cç][aã]o)|codice di (verifica|sicurezza)|verificatiecode|beveiligingscode)(?![a-z0-9])|код подтвержд|одноразов|проверочный код|验证码|驗證碼|動態密碼|确认码|認証コード|確認コード|ワンタイム/
  const USERNAME =
    /\b(user ?name|user ?id|user|login( ?id| ?name)?|log ?in|account( ?name| ?id)?|benutzer(name|kennung)?|anmeldename|kennung|identifiant|utilisateur|nom d'utilisateur|usuario|nombre de usuario|utente|nome utente|usu[aá]rio|nome de usu[aá]rio|gebruiker(snaam)?|loginfmt|uid)(?![a-z0-9])|логин|пользовател|用户名|用戶名|帳號|账号|帐号|账户|ユーザー ?名|ユーザ ?名|ログイン ?id|アカウント/
  const EMAIL =
    /\b(e ?mail|courriel|correo( electr[oó]nico)?|posta elettronica|e ?mailadres)(?![a-z0-9])|почта|邮箱|郵箱|電子郵件|电子邮件|メール/
  const ROLES = [
    [
      'additional-name',
      /\b(middle ?(name|initial)|m ?name|zweiter vorname|deuxi[eè]me pr[ée]nom|segundo nombre|secondo nome|nome do meio|tussenvoegsel)(?![a-z0-9])|отчество/,
    ],
    [
      'given-name',
      /\b(first ?name|given ?name|fore ?name|f ?name|vorname|pr[ée]nom|primer nombre|voornaam)(?![a-z0-9])|^(first|nome|nombre)$|^имя$|名字|^名$/,
    ],
    [
      'family-name',
      /\b(last ?name|sur ?name|family ?name|l ?name|nachname|familienname|nom de famille|apellidos?|cognome|sobrenome|achternaam)(?![a-z0-9])|^(last|nom)$|фамилия|^姓$/,
    ],
    [
      'organization',
      /\b(company( ?name)?|organi[sz]ation|firma|firmenname|unternehmen|soci[ée]t[ée]|entreprise|empresa|azienda|bedrijf(snaam)?)(?![a-z0-9])|компания|организация|公司|会社/,
    ],
    [
      'name',
      /\b(full ?name|your ?name|vollst[aä]ndiger name|nom complet|nombre completo|nome completo|volledige naam)(?![a-z0-9])|^(name|naam|nom et pr[ée]nom)$|фио|姓名|氏名|お名前/,
    ],
    [
      'bday',
      /\b(birth ?(day|date)?|date ?of ?birth|dob|b ?day|geburts(datum|tag)|date de naissance|fecha de nacimiento|data di nascita|data de nascimento|geboortedatum)(?![a-z0-9])|рождени|生日|出生|生年月日/,
    ],
    [
      'tel',
      /\b(phone|tel(ephone)?|mobile|cell|telefon(nummer)?|handy|t[ée]l[ée]phone|portable|tel[ée]fono|m[oó]vil|celular|cellulare|telefoon|mobiel)(?![a-z0-9])|телефон|电话|手机|電話|携帯/,
    ],
    [
      'address-line2',
      /\b(address ?(line)? ?2|addr ?2|street ?2|apt|apartment|suite|adresszusatz|compl[ée]ment( d'adresse)?|piso|interno|complemento|toevoeging)(?![a-z0-9])|квартира/,
    ],
    [
      'postal-code',
      /\b(zip( ?code)?|postal( ?code)?|post ?code|postcode|plz|postleitzahl|code postal|c[oó]digo postal|cap|cep)(?![a-z0-9])|индекс|邮编|郵便番号|郵遞區號/,
    ],
    [
      'street-address',
      /\b(street|address( ?line)?( ?1)?|addr( ?1)?|stra(ss|ß)e|adresse|rue|direcci[oó]n|calle|indirizzo|endere[cç]o|rua|straat|adres)(?![a-z0-9])|адрес|улица|地址|住所/,
    ],
    [
      'address-level2',
      /\b(city|town|stadt|ort|ville|ciudad|citt[aà]|cidade|plaats|woonplaats|localit[yà])(?![a-z0-9])|город|城市|市区町村/,
    ],
    [
      'address-level1',
      /\b(state|province|region|county|bundesland|r[ée]gion|provincia|estado|regione|provincie|prov[ií]ncia)(?![a-z0-9])|область|^省$|都道府県/,
    ],
    ['country', /\b(country|land|pays|pa[ií]s|paese)(?![a-z0-9])|страна|国家|^国$/],
  ]
  const NEW =
    /\b(new|neu(es)?|nouveau|nuevo|nueva|nuovo|nuova|novo|nova|nieuw|confirm|repeat|retype|re ?enter|again|verify)|best[aä]tig|wiederhol|confirmer|r[ée]p[ée]t|confirmar|repetir|conferma|ripeti|herhaal|bevestig|нов|подтвер|повтор|新|确认|確認|再入力|もう一度/
  const CURRENT =
    /\b(current|old|existing|aktuell|bisherig|alt(es)?|actuel|ancien|actual|anterior|attuale|vecchia|atual|antiga|huidig|oud)(?![a-z0-9])|текущ|старый|当前|旧|現在/
  const SHORT_CODE = /\b(code|pin)(?![a-z0-9])|код|码|コード/
  const NOT_A_CODE =
    /\b(zip|postal|post|promo|coupon|voucher|gift|discount|country|area|referral)(?![a-z0-9])/
  const SIGN_IN =
    /\b(sign ?in|log ?in|log ?on|anmelden|einloggen|connexion|se connecter|iniciar sesi[oó]n|acceder|ingresar|accedi|entrar|inloggen|next|weiter|continue|suivant|siguiente|avanti|continuar|pr[oó]ximo|volgende)(?![a-z0-9])|войти|вход|далее|登录|登入|ログイン|サインイン|次へ/
  const SIGN_UP =
    /\b(sign ?up|register|registration|create ?(an |your )?account|join|registrieren|registrierung|konto (erstellen|anlegen)|inscri(re|ption|bete|birse)|cr[ée]er (un )?compte|crear (una )?cuenta|reg[ií]strate|registrati|registrazione|crea (un )?account|criar conta|cadastr(o|ar)|registreren|account aanmaken)(?![a-z0-9])|регистрац|создать аккаунт|зарегистр|注册|註冊|登録|新規/
  const SUBMITS = 'button, input[type=submit], input[type=image], input[type=button], [role=button]'

  const doc = randomly()
  const named = new WeakMap()
  const byName = new Map()
  const loose = {}
  const marks = new Map()
  const observed = new WeakSet()
  const sentLast = new Map()
  const waiting = []
  let counted = 0
  let current = []
  let lastSaid = '[]'
  let timer = null
  let since = 0
  let retrying = null
  let tries = 0
  let placing = false

  function randomly() {
    const bytes = new Uint8Array(12)
    if (globalThis.crypto && typeof crypto.getRandomValues === 'function') {
      crypto.getRandomValues(bytes)
    } else {
      for (let at = 0; at < bytes.length; at++) bytes[at] = Math.floor(Math.random() * 256)
    }
    return Array.from(bytes, (one) => one.toString(16).padStart(2, '0')).join('')
  }

  function nameOf(node, prefix) {
    let id = named.get(node)
    if (!id) {
      id = prefix + ++counted
      named.set(node, id)
    }
    return id
  }

  function channel() {
    const bound = globalThis.nibPass
    if (typeof bound === 'function') return bound
    const handlers = globalThis.webkit && globalThis.webkit.messageHandlers
    const handler = handlers && handlers.nibPass
    if (handler && typeof handler.postMessage === 'function') {
      return (words) => handler.postMessage(words)
    }
    return null
  }

  function say(said) {
    const words = JSON.stringify(Object.assign({ doc }, said))
    if (words.length > LONGEST_SAID) return
    const send = channel()
    if (send && !waiting.length) {
      send(words)
      return
    }
    if (said.kind === 'forms') {
      for (let at = waiting.length - 1; at >= 0; at--) {
        if (waiting[at].forms) waiting.splice(at, 1)
      }
    }
    waiting.push({ words, forms: said.kind === 'forms' })
    if (waiting.length > 16) waiting.shift()
    retry()
  }

  function retry() {
    if (retrying !== null) return
    retrying = setTimeout(function again() {
      retrying = null
      const send = channel()
      if (send) {
        tries = 0
        while (waiting.length) send(waiting.shift().words)
        return
      }
      if (++tries >= RETRIES) {
        tries = 0
        waiting.length = 0
        return
      }
      retrying = setTimeout(again, RETRY)
    }, RETRY)
  }

  function composedParent(node) {
    if (node.parentNode) return node.parentNode
    return node.host || null
  }

  function composedElementParent(el) {
    if (el.parentElement) return el.parentElement
    const up = el.parentNode
    return up && up.host ? up.host : null
  }

  function typeOf(el) {
    if (el instanceof HTMLSelectElement) return 'select'
    if (el instanceof HTMLTextAreaElement) return 'textarea'
    return String(el.getAttribute('type') || '').toLowerCase()
  }

  function fieldy(node) {
    if (node instanceof HTMLSelectElement || node instanceof HTMLTextAreaElement) return true
    return node instanceof HTMLInputElement && TEXTISH.has(typeOf(node))
  }

  function gather(root, fields, shadows) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (fields.length >= MOST_FIELDS * 4 || shadows.length >= MOST_ROOTS) return
      if (node.localName === MARK_NAME) continue
      if (fieldy(node)) fields.push(node)
      if (node.shadowRoot) {
        shadows.push(node.shadowRoot)
        gather(node.shadowRoot, fields, shadows)
      }
    }
  }

  function normal(text, most) {
    return String(text)
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_.[\]:*#()-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .slice(0, most || 120)
  }

  function partsOf(el) {
    const parts = []
    const attributes = (one) => {
      for (const key of ['name', 'id', 'placeholder', 'aria-label', 'title', 'label']) {
        const said = one.getAttribute(key)
        if (said) parts.push(said)
      }
    }
    attributes(el)
    if (el.labels) for (const label of el.labels) parts.push(label.textContent || '')
    const root = el.getRootNode()
    const by = el.getAttribute('aria-labelledby')
    if (by && typeof root.getElementById === 'function') {
      for (const id of by.split(/\s+/)) {
        const one = id ? root.getElementById(id) : null
        if (one) parts.push(one.textContent || '')
      }
    }
    if (root.host) attributes(root.host)
    return parts.map((one) => normal(one)).filter(Boolean)
  }

  function autocompleted(el) {
    const tokens = String(el.getAttribute('autocomplete') || '')
      .toLowerCase()
      .split(/\s+/)
    for (let at = tokens.length - 1; at >= 0; at--) {
      const role = AUTOCOMPLETE[tokens[at]]
      if (role) return role
    }
    return null
  }

  function roleOf(el, parts, type) {
    const auto = autocompleted(el)
    const said = (pattern) => parts.some((one) => pattern.test(one))
    if (type === 'password') {
      if (auto === 'new-password') return 'new-password'
      if (auto === 'password') return 'password'
      return said(NEW) && !said(CURRENT) ? 'new-password' : 'password'
    }
    if (auto) return auto
    if (said(CC_NUMBER)) return 'cc-number'
    if (said(CC_CSC)) return 'cc-csc'
    if (said(CC_EXP_MONTH)) return 'cc-exp-month'
    if (said(CC_EXP_YEAR)) return 'cc-exp-year'
    if (said(CC_EXP)) return 'cc-exp'
    if (said(CC_NAME)) return 'cc-name'
    if (said(TOTP)) return 'totp'
    if (type === 'email') return 'email'
    if (said(USERNAME)) return 'username'
    if (said(EMAIL)) return 'email'
    for (const [role, pattern] of ROLES) if (said(pattern)) return role
    if (type === 'tel') return 'tel'
    if (
      el instanceof HTMLInputElement &&
      said(SHORT_CODE) &&
      !said(NOT_A_CODE) &&
      el.maxLength >= 4 &&
      el.maxLength <= 10
    ) {
      return 'totp'
    }
    return 'unknown'
  }

  function visible(el) {
    if (el.hidden || typeOf(el) === 'hidden') return false
    if (typeof el.checkVisibility === 'function') {
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false
    } else {
      const own = getComputedStyle(el)
      if (own.visibility === 'hidden' || own.visibility === 'collapse') return false
      for (let at = el; at; at = composedElementParent(at)) {
        const style = getComputedStyle(at)
        if (style.display === 'none' || parseFloat(style.opacity) === 0) return false
      }
    }
    const box = el.getBoundingClientRect()
    if (box.width < 4 || box.height < 4) return false
    return box.right + (globalThis.scrollX || 0) > 0 && box.bottom + (globalThis.scrollY || 0) > 0
  }

  function shownEnough(el) {
    let shown = 1
    for (let at = el; at; at = composedElementParent(at)) {
      const own = parseFloat(getComputedStyle(at).opacity)
      if (!Number.isNaN(own)) shown *= own
      if (shown < LEAST_SHOWN) return false
    }
    return true
  }

  function uncovered(el, box) {
    const root = el.getRootNode()
    const asked = root && typeof root.elementFromPoint === 'function' ? root : document
    if (typeof asked.elementFromPoint !== 'function') return true
    const hit = asked.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    if (!hit) return false
    return (
      hit === el ||
      el.contains(hit) ||
      hit.localName === MARK_NAME ||
      (hit instanceof HTMLLabelElement && hit.control === el)
    )
  }

  function fillable(el) {
    if (!visible(el)) return false
    const box = el.getBoundingClientRect()
    if (box.width < LEAST_SIDE || box.height < LEAST_SIDE) return false
    const wide = globalThis.innerWidth || document.documentElement.clientWidth
    const tall = globalThis.innerHeight || document.documentElement.clientHeight
    if (box.right <= 0 || box.bottom <= 0 || box.left >= wide || box.top >= tall) return false
    return shownEnough(el) && uncovered(el, box)
  }

  function formOf(el) {
    if (el.form) return el.form
    for (let at = composedParent(el); at; at = composedParent(at)) {
      if (at instanceof HTMLFormElement) return at
    }
    return loose
  }

  function signalsOf(form) {
    const parts = [location.pathname]
    if (form === loose) {
      parts.push(document.title)
    } else {
      for (const key of ['id', 'name', 'action', 'class', 'aria-label']) {
        parts.push(form.getAttribute(key) || '')
      }
      let counting = 0
      for (const button of form.querySelectorAll(SUBMITS)) {
        if (++counting > 6) break
        parts.push(button.textContent || button.value || '')
      }
    }
    return normal(parts.join(' '), 800)
  }

  function sixBoxes(fields) {
    let run = []
    const runs = []
    for (const one of fields) {
      const box = one.el instanceof HTMLInputElement && one.el.maxLength === 1 && one.visible
      if (box) run.push(one)
      else {
        if (run.length) runs.push(run)
        run = []
      }
    }
    if (run.length) runs.push(run)
    for (const boxes of runs) {
      if (boxes.length < 4 || boxes.length > 8) continue
      for (const one of boxes) {
        if (one.role === 'unknown' || one.role === 'tel' || one.role === 'totp') one.role = 'totp'
      }
    }
  }

  function textish(one) {
    return one.type !== 'password' && one.type !== 'select' && one.type !== 'textarea'
  }

  function classify(form, fields) {
    sixBoxes(fields)
    const seen = fields.filter((one) => one.visible)
    const has = (role) => seen.some((one) => one.role === role)
    if (has('cc-number')) {
      for (const one of fields) if (one.role === 'totp') one.role = 'cc-csc'
      return 'card'
    }
    const passwords = seen.filter((one) => one.type === 'password')
    const userish = seen.filter((one) => one.role === 'username' || one.role === 'email')
    const identity = new Set(seen.filter((one) => IDENTITY.has(one.role)).map((one) => one.role))
    const signals = signalsOf(form)
    const signsUp = SIGN_UP.test(signals)
    const signsIn = SIGN_IN.test(signals)
    const texts = seen.filter(textish)

    if (!passwords.length) {
      if (has('totp')) return 'totp'
      if (userish.length && texts.length <= 2) {
        const hiddenPassword = fields.some((one) => one.type === 'password' && !one.visible)
        const declared = userish.some(
          (one) =>
            autocompleted(one.el) === 'username' ||
            /webauthn/.test(one.el.getAttribute('autocomplete') || '') ||
            one.parts.some((part) => USERNAME.test(part)),
        )
        if (hiddenPassword || declared || (signsIn && !signsUp)) return 'username'
      }
      if (identity.size >= 2) return 'identity'
      return null
    }

    const renew = (from) => {
      for (const one of passwords.slice(from)) one.role = 'new-password'
    }
    let kind
    if (passwords.length >= 3) {
      kind = 'change'
      if (passwords[0].role !== 'new-password' || saysCurrent(passwords[0])) {
        passwords[0].role = 'password'
        renew(1)
      } else renew(0)
    } else if (passwords.length === 2) {
      const first = passwords[0]
      if (autocompleted(first.el) === 'password' || saysCurrent(first)) {
        kind = 'change'
        first.role = 'password'
        renew(1)
      } else {
        kind = userish.length || identity.size ? 'signup' : 'change'
        renew(0)
      }
    } else {
      const only = passwords[0]
      if (only.role === 'new-password') {
        kind = userish.length || identity.size || texts.length ? 'signup' : 'change'
      } else if (signsUp && texts.length >= 2 && (!signsIn || texts.length >= 3)) {
        kind = 'signup'
        renew(0)
      } else if (userish.length || before(seen, only)) {
        kind = 'login'
      } else {
        kind = 'password'
      }
    }

    if (kind === 'login' && !userish.length) {
      const one = before(seen, passwords[0])
      if (one) one.role = one.type === 'email' ? 'email' : 'username'
    }
    return kind
  }

  function saysCurrent(one) {
    return one.parts.some((part) => CURRENT.test(part))
  }

  function before(seen, password) {
    const at = seen.indexOf(password)
    for (let back = at - 1; back >= 0; back--) {
      const one = seen[back]
      if (
        textish(one) &&
        (one.role === 'unknown' || one.role === 'username' || one.role === 'email')
      ) {
        return one
      }
    }
    return null
  }

  function scan() {
    timer = null
    const fields = []
    const shadows = []
    gather(document, fields, shadows)
    for (const root of shadows) {
      if (!observed.has(root)) {
        observed.add(root)
        observer.observe(root, WATCHED)
      }
    }

    const groups = new Map()
    for (const el of fields) {
      const form = formOf(el)
      if (!groups.has(form)) groups.set(form, [])
      groups.get(form).push(el)
    }

    const forms = []
    for (const [form, held] of groups) {
      if (forms.length >= MOST_FORMS) break
      const read = held.slice(0, MOST_FIELDS).map((el) => {
        const parts = partsOf(el)
        const type = typeOf(el)
        return { el, parts, type, role: roleOf(el, parts, type), visible: visible(el) }
      })
      const kind = classify(form, read)
      if (!kind) continue
      forms.push({ id: nameOf(form, 'f'), form, kind, fields: read })
    }

    for (const old of current) {
      if (
        !forms.some((one) => one.form === old.form) ||
        old.fields.some((one) => !one.el.isConnected)
      ) {
        sent(old)
      }
    }
    current = forms
    byName.clear()
    for (const form of forms) {
      for (const one of form.fields) byName.set(nameOf(one.el, 'e'), { form, one })
    }

    const said = forms.map((form) => ({
      form: form.id,
      kind: form.kind,
      fields: form.fields.map((one) => ({
        field: nameOf(one.el, 'e'),
        role: one.role,
        visible: one.visible,
      })),
    }))
    const words = JSON.stringify(said)
    if (words !== lastSaid) {
      lastSaid = words
      say({ kind: 'forms', forms: said })
    }
    placeMarks()
  }

  function soon() {
    const now = Date.now()
    if (timer === null) since = now
    else clearTimeout(timer)
    timer = setTimeout(scan, now - since >= LONGEST_QUIET ? 0 : QUIET)
  }

  function ours(record) {
    if (record.target && record.target.localName === MARK_NAME) return true
    if (record.type !== 'childList') return false
    const nodes = [...record.addedNodes, ...record.removedNodes]
    return nodes.length > 0 && nodes.every((node) => node.localName === MARK_NAME)
  }

  const WATCHED = {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['type', 'hidden', 'style', 'class', 'autocomplete', 'name', 'disabled'],
  }
  const observer = new MutationObserver((records) => {
    if (records.some((record) => !ours(record))) soon()
  })

  function markable(form) {
    const chosen = []
    const seen = form.fields.filter((one) => one.visible)
    for (const one of seen) {
      if (['username', 'email', 'password', 'new-password'].includes(one.role)) chosen.push(one)
    }
    for (const group of [['totp'], [...CARD], [...IDENTITY]]) {
      const first = seen.find((one) => group.includes(one.role))
      if (first && !chosen.includes(first)) chosen.push(first)
    }
    return chosen
  }

  function important(style, values) {
    for (const key of Object.keys(values)) style.setProperty(key, values[key], 'important')
  }

  function madeMark(form, one) {
    const host = document.createElement(MARK_NAME)
    important(host.style, {
      all: 'initial',
      position: 'fixed',
      display: 'block',
      width: MARK + 'px',
      height: MARK + 'px',
      margin: '0',
      padding: '0',
      border: '0',
      'z-index': '2147483647',
    })
    const shadow = host.attachShadow({ mode: 'closed' })
    const button = document.createElement('button')
    button.type = 'button'
    button.setAttribute('aria-label', 'Orden Pass')
    button.tabIndex = -1
    important(button.style, {
      all: 'initial',
      display: 'block',
      'box-sizing': 'border-box',
      width: MARK + 'px',
      height: MARK + 'px',
      'border-radius': '4px',
      background: '#6d4aff',
      cursor: 'pointer',
      'box-shadow': '0 0 0 1px rgba(255, 255, 255, 0.6)',
    })
    const dot = document.createElement('span')
    important(dot.style, {
      all: 'initial',
      display: 'block',
      width: '6px',
      height: '6px',
      margin: '5px',
      'border-radius': '50%',
      background: '#ffffff',
    })
    button.appendChild(dot)
    shadow.appendChild(button)
    const held = (event) => {
      event.preventDefault()
      event.stopPropagation()
    }
    button.addEventListener('pointerdown', held)
    button.addEventListener('mousedown', held)
    button.addEventListener('click', (event) => {
      held(event)
      if (!event.isTrusted) return
      const mark = marks.get(one.el)
      if (mark) say({ kind: 'mark', form: mark.form, field: mark.field })
    })
    return { host, form: form.id, field: nameOf(one.el, 'e') }
  }

  function placeMarks() {
    const wanted = new Map()
    for (const form of current) for (const one of markable(form)) wanted.set(one.el, { form, one })
    for (const [el, mark] of marks) {
      if (!wanted.has(el)) {
        mark.host.remove()
        marks.delete(el)
      }
    }
    const top = document.documentElement
    if (!top) return
    for (const [el, { form, one }] of wanted) {
      let mark = marks.get(el)
      if (!mark) {
        mark = madeMark(form, one)
        marks.set(el, mark)
      }
      mark.form = form.id
      if (mark.host.parentNode !== top) top.appendChild(mark.host)
    }
    place()
  }

  function place() {
    for (const [el, mark] of marks) {
      const box = el.getBoundingClientRect()
      const shown = el.isConnected && box.width >= MARK + 8 && box.height >= MARK
      important(mark.host.style, {
        display: shown ? 'block' : 'none',
        left: Math.round(box.right - MARK - 6) + 'px',
        top: Math.round(box.top + (box.height - MARK) / 2) + 'px',
      })
    }
  }

  function placeSoon() {
    if (placing || !marks.size) return
    placing = true
    const later = globalThis.requestAnimationFrame || ((then) => setTimeout(then, 16))
    later(() => {
      placing = false
      place()
    })
  }

  function deepFocus() {
    let at = document.activeElement
    while (at && at.shadowRoot && at.shadowRoot.activeElement) at = at.shadowRoot.activeElement
    return at
  }

  function valueOf(form, roles) {
    const held = form.fields.filter((one) => roles.includes(one.role) && one.el.value)
    const chosen = held.find((one) => one.visible) || held[0]
    return chosen ? String(chosen.el.value) : null
  }

  function sent(form) {
    if (!SENDS.has(form.kind)) return
    const username = valueOf(form, ['username', 'email'])
    const password = valueOf(form, ['password'])
    const newPassword = valueOf(form, ['new-password'])
    if (!password && !newPassword && !(form.kind === 'username' && username)) return
    const key = JSON.stringify([username, password, newPassword])
    if (sentLast.get(form.id) === key) return
    sentLast.set(form.id, key)
    say({
      kind: 'submitted',
      form: form.id,
      formKind: form.kind,
      username,
      password,
      newPassword,
    })
  }

  function recordOf(el) {
    const held = byName.get(named.get(el))
    if (held) return held.form
    const form = formOf(el)
    return current.find((one) => one.form === form) || null
  }

  function pressedButton(event) {
    for (const node of event.composedPath()) {
      if (!(node instanceof Element)) continue
      if (node.localName === MARK_NAME) return null
      if (node.matches(SUBMITS)) return node
    }
    return null
  }

  function submits(button) {
    const type = String(button.getAttribute('type') || '').toLowerCase()
    if (button instanceof HTMLButtonElement && (type === '' || type === 'submit') && button.form) {
      return true
    }
    if (button instanceof HTMLInputElement && (type === 'submit' || type === 'image')) return true
    const words = normal(
      [button.textContent, button.value, button.getAttribute('aria-label')]
        .filter(Boolean)
        .join(' '),
      200,
    )
    return (
      SIGN_IN.test(words) ||
      SIGN_UP.test(words) ||
      /\b(submit|save|update|change)(?![a-z0-9])/.test(words)
    )
  }

  function leaving() {
    for (const form of current) sent(form)
  }

  addEventListener(
    'submit',
    (event) => {
      const form = current.find((one) => one.form === event.target)
      if (form) sent(form)
    },
    true,
  )

  addEventListener(
    'click',
    (event) => {
      if (!event.isTrusted) return
      const button = pressedButton(event)
      if (!button || !submits(button)) return
      const form = recordOf(button) || current.find((one) => one.form === loose)
      if (form) sent(form)
    },
    true,
  )

  addEventListener(
    'keydown',
    (event) => {
      if (!event.isTrusted) return
      if (event.key === 'Enter' && !event.isComposing) {
        const target = event.composedPath()[0]
        const form = target instanceof Element ? recordOf(target) : null
        if (form && byName.has(named.get(target))) sent(form)
        return
      }
      const chord = (event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey
      if (!chord || (event.code !== 'KeyL' && String(event.key).toLowerCase() !== 'l')) return
      const focused = deepFocus()
      let held = focused ? byName.get(named.get(focused)) : null
      if (!held || !held.one.visible) {
        held = null
        for (const form of current) {
          const first = markable(form)[0]
          if (first) {
            held = { form, one: first }
            break
          }
        }
      }
      if (!held) return
      event.preventDefault()
      say({ kind: 'mark', form: held.form.id, field: nameOf(held.one.el, 'e') })
    },
    true,
  )

  addEventListener(
    'focusin',
    (event) => {
      if (event.isTrusted) soon()
    },
    true,
  )
  addEventListener('scroll', placeSoon, { capture: true, passive: true })
  addEventListener('resize', placeSoon, { passive: true })
  addEventListener('pagehide', leaving, true)
  addEventListener('beforeunload', leaving, true)
  addEventListener('popstate', leaving, true)
  if (globalThis.navigation && typeof globalThis.navigation.addEventListener === 'function') {
    globalThis.navigation.addEventListener('navigate', leaving)
  }

  function chosenOption(select, value) {
    const options = Array.from(select.options)
    const wanted = String(value).trim().toLowerCase()
    const number = /^\d+$/.test(wanted) ? Number(wanted) : null
    return (
      options.find((one) => one.value === value) ||
      options.find((one) => one.value.toLowerCase() === wanted) ||
      options.find((one) => one.text.trim().toLowerCase() === wanted) ||
      (number === null
        ? null
        : options.find((one) => {
            const said = one.value.trim() || one.text.trim()
            if (!/^\d+$/.test(said)) return false
            return Number(said) === number || (said.length === 2 && Number(said) === number % 100)
          })) ||
      null
    )
  }

  function nativeValue(el, value) {
    for (let at = Object.getPrototypeOf(el); at; at = Object.getPrototypeOf(at)) {
      const own = Object.getOwnPropertyDescriptor(at, 'value')
      if (own && typeof own.set === 'function') {
        own.set.call(el, value)
        return
      }
    }
  }

  function put(el, value) {
    el.focus()
    if (el instanceof HTMLSelectElement) {
      const option = chosenOption(el, value)
      if (!option) {
        el.blur()
        return false
      }
      nativeValue(el, option.value)
      el.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    } else {
      nativeValue(el, value)
      el.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          composed: true,
          inputType: 'insertReplacementText',
          data: value,
        }),
      )
    }
    el.dispatchEvent(new Event('change', { bubbles: true }))
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, composed: true }))
    el.blur()
    return true
  }

  function spread(form, one, value) {
    const boxes = form.fields.filter((other) => other.role === 'totp' && other.visible)
    let at = boxes.indexOf(one)
    let last = null
    for (const letter of value) {
      const box = boxes[at++]
      if (!box) break
      if (fillable(box.el) && put(box.el, letter)) last = box.el
    }
    return last
  }

  function submitter(form) {
    const scope = form.form === loose ? document : form.form
    const buttons = Array.from(scope.querySelectorAll(SUBMITS)).filter((one) => visible(one))
    return (
      buttons.find((one) => {
        const type = String(one.getAttribute('type') || '').toLowerCase()
        return (
          type === 'submit' || type === 'image' || (one instanceof HTMLButtonElement && type === '')
        )
      }) ||
      buttons.find(submits) ||
      null
    )
  }

  function enter(el) {
    el.focus()
    for (const type of ['keydown', 'keypress', 'keyup']) {
      el.dispatchEvent(
        new KeyboardEvent(type, {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          composed: true,
        }),
      )
    }
  }

  function send(form, last) {
    const button = submitter(form)
    if (form.form !== loose && typeof form.form.requestSubmit === 'function') {
      try {
        const submitting = button && button.form === form.form ? button : undefined
        if (submitting) form.form.requestSubmit(submitting)
        else form.form.requestSubmit()
        return
      } catch {
        if (button) {
          button.click()
          return
        }
      }
    }
    if (button) button.click()
    else if (last) enter(last)
  }

  function fill(asked) {
    if (!asked || typeof asked !== 'object') return false
    if (typeof asked.doc === 'string' && asked.doc !== doc) return false
    if (typeof asked.origin === 'string' && asked.origin !== location.origin) return false
    const form = current.find((one) => one.id === asked.form)
    const values = asked.values
    if (!form || !values || typeof values !== 'object') return false
    let last = null
    for (const id of Object.keys(values)) {
      const held = byName.get(id)
      const value = values[id]
      if (!held || held.form !== form || typeof value !== 'string') continue
      const el = held.one.el
      if (!el.isConnected || !fillable(el) || el.disabled || el.readOnly) continue
      if (held.one.role === 'totp' && el.maxLength === 1 && value.length > 1) {
        last = spread(form, held.one, value) || last
      } else if (put(el, value)) {
        last = el
      }
    }
    if (last && asked.submit === true) send(form, last)
    return last !== null
  }

  globalThis.__nibPass = Object.freeze({ fill })

  observer.observe(document, WATCHED)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scan, { once: true })
  } else {
    scan()
  }
})()
