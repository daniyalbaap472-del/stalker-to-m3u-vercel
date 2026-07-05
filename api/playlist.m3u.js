
module.exports = async (req, res) => {
  const PORTAL = 'http://tv.stream4k.cc/stalker_portal';
  const MAC = '00:1A:79:6B:3E:BA';
  const DEVICE_ID = '3072FEA60F4D8D777CA4CFAF29F3FDDD61B8547664B6E44AC9F7387EA47B2671';
  const DEVICE_ID2 = '3072FEA60F4D8D777CA4CFAF29F3FDDD61B8547664B6E44AC9F7387EA47B2671';
  const SIGNATURE = 'D3B5F503CFAAA';
  const SERIAL = '022017J023063';

  const BASE = PORTAL.replace(/\/+$/, '');

  // Try different endpoint combos
  const ENDPOINTS = [
    { handshake: '/portal.php', genres: '/server/load.php', channels: '/portal.php' },
    { handshake: '/portal.php', genres: '/portal.php', channels: '/portal.php' },
    { handshake: '/server/load.php', genres: '/server/load.php', channels: '/server/load.php' },
    { handshake: '/stalker_portal/server/load.php', genres: '/stalker_portal/server/load.php', channels: '/stalker_portal/server/load.php' },
  ];

  async function callAPI(endpoint, params, token) {
    const url = `${BASE}${endpoint}?${params}&JsHttpRequest=1-xml`;
    const headers = {
      'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 4 rev: 2116 Mobile Safari/533.3',
      'Cookie': `mac=${MAC}; stb_lang=en; timezone=Europe/Moscow`,
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    } else {
      headers['Authorization'] = `MAC ${MAC}`;
    }
    
    const resp = await fetch(url, { headers, timeout: 15000 });
    return await resp.json();
  }

  try {
    // Try each endpoint combo until one works
    let token = null;
    let workingEndpoints = null;

    for (const ep of ENDPOINTS) {
      try {
        const hs = await callAPI(ep.handshake, 'type=stb&action=handshake&token=', null);
        if (hs?.js?.token) {
          token = hs.js.token;
          workingEndpoints = ep;
          break;
        }
      } catch (e) { /* try next */ }
    }

    if (!token) {
      return res.status(401).type('text').end('# Handshake failed with all endpoints\n');
    }

    // Get genres
    let genres = {};
    try {
      const gr = await callAPI(workingEndpoints.genres, 'type=itv&action=get_genres', token);
      if (gr?.js) {
        for (const g of gr.js) genres[g.id] = g.title;
      }
    } catch (e) { /* genres optional */ }

    // Get channels
    let channels = [];
    try {
      const cr = await callAPI(workingEndpoints.channels, 'type=itv&action=get_all_channels&force_ch_link_check=', token);
      channels = cr?.js?.data || [];
    } catch (e) { /* try alternative */ }

    // If still 0, try get_ordered_list per genre
    if (channels.length === 0 && Object.keys(genres).length > 0) {
      for (const [genreId, genreName] of Object.entries(genres)) {
        try {
          const or = await callAPI(workingEndpoints.channels, `type=itv&action=get_ordered_list&genre=${genreId}&force_ch_link_check=&fav=0&sortby=number&hd=0&p=1`, token);
          const genreChs = or?.js?.data || [];
          channels.push(...genreChs.map(ch => ({ ...ch, tv_genre_id: genreId })));
        } catch (e) { /* skip genre */ }
      }
    }

    // Build M3U
    let m3u = '#EXTM3U\n';
    let count = 0;
    for (const ch of channels) {
      const name = ch.name || 'Unknown';
      const logo = ch.logo || '';
      const genre = genres[ch.tv_genre_id] || 'General';
      let stream = '';
      if (ch.cmds?.length) {
        stream = (ch.cmds[0].url || '').replace(/^ffmpeg\s+/, '');
      }
      // If stream has localhost, try to resolve via create_link
      if (stream && stream.includes('localhost')) {
        try {
          const cl = await callAPI(workingEndpoints.channels, `type=itv&action=create_link&cmd=${encodeURIComponent(stream)}&series=&forced_storage=undefined&disable_ad=0&download=0`, token);
          if (cl?.js?.cmd) {
            stream = cl.js.cmd.replace(/^ffmpeg\s+/, '');
          }
        } catch (e) { /* use original */ }
      }
      if (stream) {
        m3u += `#EXTINF:-1 tvg-logo="${logo}" group-title="${genre}",${name}\n${stream}\n`;
        count++;
      }
    }

    res.setHeader('Content-Type', 'audio/x-mpegurl');
    res.status(200).end(m3u);
  } catch (e) {
    res.status(500).type('text').end(`# Error: ${e.message}\n`);
  }
};
