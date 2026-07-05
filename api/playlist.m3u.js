module.exports = async (req, res) => {
  // === CONFIG — Change these to your credentials ===
  const PORTAL_URL = 'http://tivi.stream4k.cc/stalker_portal';
  const MAC = '00:1A:79:6B:3E:BA';
  const DEVICE_ID = '3072FEA60F4D8D777CA4CFAF29F3FDDD61B8547664B6E44AC9F7387EA47B2671';
  const DEVICE_ID2 = '3072FEA60F4D8D777CA4CFAF29F3FDDD61B8547664B6E44AC9F7387EA47B2671';
  const SIGNATURE = 'D3B5F503CFAAA';
  const SERIAL = '022017J023063'; // You may need to get this from STBemu or your provider
  // =================================================

  const BASE = PORTAL_URL.replace(/\/+$/, '');
  const COOKIE = `PHPSESSID=null; sn=${SERIAL}; mac=${MAC}; stb_lang=en; timezone=Europe/Moscow`;

  async function api(path, token) {
    const url = `${BASE}/portal.php${path}`;
    const headers = {
      'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 4 rev: 2116 Mobile Safari/533.3',
      'X-User-Agent': 'Model: MAG250; Link: Ethernet',
      'Cookie': COOKIE,
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest'
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    else headers['Authorization'] = `MAC ${MAC}`;

    const resp = await fetch(url, { headers, timeout: 15000 });
    const text = await resp.text();
    return JSON.parse(text);
  }

  try {
    // Step 1: Handshake
    const handshake = await api('?action=handshake&type=stb&token=&JsHttpRequest=1-xml', null);
    const token = handshake?.js?.token;
    if (!token) {
      return res.status(401).end('# Failed to authenticate\n');
    }

    // Step 2: Get genres
    const genresResp = await api('?type=itv&action=get_genres&JsHttpRequest=1-xml', token);
    const genres = {};
    if (genresResp?.js) {
      for (const g of genresResp.js) {
        genres[g.id] = g.title;
      }
    }

    // Step 3: Get all channels
    const channelsResp = await api('?type=itv&action=get_all_channels&JsHttpRequest=1-xml', token);
    const channels = channelsResp?.js?.data || [];

    // Step 4: Build M3U
    let m3u = '#EXTM3U\n';
    for (const ch of channels) {
      const name = ch.name || 'Unknown';
      const logo = ch.logo || '';
      const genreName = genres[ch.tv_genre_id] || 'General';
      
      // Get stream URL from cmds
      let streamUrl = '';
      if (ch.cmds && ch.cmds.length > 0) {
        let cmd = ch.cmds[0].url || '';
        cmd = cmd.replace(/^ffmpeg\s+/, '');
        streamUrl = cmd;
      }

      if (streamUrl) {
        m3u += `#EXTINF:-1 tvg-logo="${logo}" group-title="${genreName}",${name}\n`;
        m3u += `${streamUrl}\n`;
      }
    }

    res.setHeader('Content-Type', 'audio/x-mpegurl');
    res.setHeader('Content-Disposition', 'attachment; filename="playlist.m3u"');
    res.status(200).end(m3u);
  } catch (err) {
    res.status(500).end(`# Error: ${err.message}\n`);
  }
};
