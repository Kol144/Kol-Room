export function announcement(song, settings) {
  let text=(song.pronunciation || song.title || '').normalize('NFC').replace(/_/g,' ').replace(/\.(mp3|wav|flac|m4a)$/i,'').trim();
  const english=/\b(the|your|you|my|don't|love|kill|vibe|alive|dear|count|me|in|all|time|low|night|heart)\b/i.test(text);
  const spanish=/[áéíóúñ¿¡]|\b(el|la|los|las|una|del|corazón|canción|soy|eres|quiero)\b/i.test(text);
  const lang=song.speechLanguage || (!spanish && english ? 'en-US' : settings.voiceLang || 'es-ES');
  if (lang.startsWith('en')) text=text.replace(/\bur\b/gi,'your').replace(/&/g,' and ');
  if (text===text.toUpperCase() && text.length>4) text=text.toLowerCase();
  const automatic=!settings.voiceURI || settings.voiceURI==='frumos:piper-davefx' || settings.voiceURI==='kolroom:piper-lessac-en';
  return {text,settings:{...settings,voiceLang:lang,
    voiceURI:automatic ? lang.startsWith('en') ? 'kolroom:piper-lessac-en' : 'frumos:piper-davefx' : settings.voiceURI}};
}
