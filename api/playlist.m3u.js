
module.exports = async (req, res) => {
  const PORTAL = 'http://tivi.stream4k.cc/stalker_portal';
  const MAC = '00:1A:79:6B:3E:BA';
  const SERIAL = '022017J023063';
  const DEVICE_ID = '3072FEA60F4D8D777CA4CFAF29F3FDDD61B8547664B6E44AC9F7387EA47B2671';
  const DEVICE_ID2 = '3072FEA60F4D8D777CA4CFAF29F3FDDD61B8547664B6E44AC9F7387EA47B2671';

  const BASE = PORTAL.replace(/\/+$/, '');
  
  // Try different endpoint paths
  const ENDPOINTS = [
    { name: 'portal.php', path: '/portal.php' },
    { name: 'c/portal.php', path: '/c/portal.php' },
    { name: 'server/load.php', path: '/server/load.php' },
    { name: 'stalker_portal/server/load.php', path: '/stalker_portal/server/load.php' },
    { name: 'server/portal.php', path: '/server/portal.php' },
    { name: '/portal.php', path: '/portal.php' },
  ];

  const COOKIE = `PHPSESSID=null; sn=${SERIAL}; mac=${MAC}; stb_lang=en; timezone=Europe/Moscow`;
  const UA = 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 4 rev: 2116 Mobile Safari/533.3';

  async function api(url, useBearer) {
    const headers = {
      'User-Agent': UA,
      'Cookie': COOKIE,
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
    };
    if (useBearer) {
      headers['Authorization'] = `Bearer ${useBearer}`;
    }
    const resp = await fetch(url, { headers, timeout: 15000 });
    const text = await resp.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      return { error: text.substring(0, 500) };
    }
  }

  try {
    // === STEP 1: Find the correct endpoint and handshake ===
    let token = null;
    let endp = null;

    for (const ep of ENDPOINTS) {
      try {
        const url = `${BASE}${ep.path}?type=stb&action=handshake&prehash=0&token=&JsHttpRequest=1-xml`;
        const hs = await api(url, null);
        // Token can be in "Token" (capitalized) or "token"
        const t = hs?.js?.Token || hs?.js?.token;
        if (t) {
          token = t;
          endp = ep;
          break;
        }
        // If js is truthy but no token, token was accepted
        if (hs?.js && typeof hs.js === 'object' && !hs.js.Token && !hs.js.token) {
          token = ''; // token was accepted as-is
          endp = ep;
          break;
        }
      } catch (e) { /* try next */ }
    }

    if (!endp) {
      return res.status(401).type('text').end('# Handshake failed with all endpoints\n');
    }

    const LOC = `${BASE}${endp.path}`;

    // If token is empty, we still need to get one via handshake with empty token
    if (token === '') {
      // Try getting profile which returns token
      const pr = await api(`${LOC}?type=stb&action=get_profile&JsHttpRequest=1-xml`, '');
      token = pr?.js?.token || '';
    }

    if (!token) {
      return res.status(401).type('text').end('# No token obtained\n');
    }

    // === STEP 2: Get genres ===
    let genres = {};
    try {
      const gr = await api(`${LOC}?type=itv&action=get_genres&JsHttpRequest=1-xml`, token);
      if (gr?.js && Array.isArray(gr.js)) {
        for (const g of gr.js) genres[g.id] = g.title;
      }
    } catch (e) { /* genres optional */ }

    // === STEP 3: Get channels ===
    let channels = [];
    
    // Try get_all_channels first
    try {
      const cr = await api(`${LOC}?type=itv&action=get_all_channels&force_ch_link_check=&JsHttpRequest=1-xml`, token);
      if (cr?.js?.data && Array.isArray(cr.js.data)) {
        channels = cr.js.data;
      } else if (cr?.js && Array.isArray(cr.js)) {
        channels = cr.js;
      }
    } catch (e) { /* try ordered list */ }

    // If no channels, try get_ordered_list per genre
    if (channels.length === 0 && Object.keys(genres).length > 0) {
      for (const genreId of Object.keys(genres)) {
        try {
          const or = await api(`${LOC}?type=itv&action=get_ordered_list&genre=${genreId}&force_ch_link_check=&fav=0&sortby=number&hd=0&p=1&JsHttpRequest=1-xml`, token);
          const data = or?.js?.data || or?.js || [];
          if (Array.isArray(data)) {
            channels.push(...data.map(ch => ({ ...ch, tv_genre_id: genreId })));
          }
        } catch (e) { /* skip genre */ }
      }
    }

    // === STEP 4: Build M3U with create_link for each channel ===
    let m3u = '#EXTM3U\n';
    let count = 0;
    
    for (const ch of channels) {
      const name = ch.name || 'Unknown';
      const logo = ch.logo || '';
      const genre = genres[ch.tv_genre_id] || 'General';
      
      // Get the cmd value - can be in cmd string or in cmds array
      let cmd = ch.cmd || '';
      if (!cmd && ch.cmds && ch.cmds.length > 0) {
        cmd = ch.cmds[0].url || ch.cmds[0].cmd || '';
      }
      
      if (cmd) {
        // Strip ffmpeg prefix
        cmd = cmd.replace(/^ffmpeg\s+/, '').trim();
        
        // If contains localhost or relative path, use create_link
        if (cmd.includes('localhost') || cmd.startsWith('/') || cmd.match(/^\d+$/)) {
          try {
            const cl = await api(`${LOC}?type=itv&action=create_link&cmd=${encodeURIComponent(cmd)}&series=&forced_storage=undefined&disable_ad=0&download=0&JsHttpRequest=1-xml`, token);
            let newCmd = cl?.js?.cmd || '';
            newCmd = newCmd.replace(/^ffmpeg\s+/, '').trim();
            if (newCmd) cmd = newCmd;
          } catch (e) { /* use original cmd */ }
        }
        
        // If still relative, try create_link with just the ID
        if (cmd.match(/^\d+$/)) {
          try {
            const cl = await api(`${LOC}?type=itv&action=create_link&cmd=${cmd}&series=&forced_storage=undefined&disable_ad=0&download=0&JsHttpRequest=1-xml`, token);
            let newCmd = cl?.js?.cmd || '';
            newCmd = newCmd.replace(/^ffmpeg\s+/, '').trim();
            if (newCmd) cmd = newCmd;
          } catch (e) { /* skip */ }
        }
        
        m3u += `#EXTINF:-1 tvg-logo="${logo}" group-title="${genre}",${name}\n${cmd}\n`;
        count++;
      }
    }

    res.setHeader('Content-Type', 'audio/x-mpegurl');
    res.status(200).end(m3u);
  } catch (e) {
    res.status(500).type('text').end(`# Error: ${e.message}\n`);
  }
};
