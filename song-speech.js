import {englishVoice, spanishVoice} from './neural-voice.js';

const englishWords = new Set(`again alive all alone and away back beautiful before black broken can can't come count
  dance day dear don't down dream dreams ever every eyes fall feel fire for forever free good gone heart hello
  here highway home in inside into is kill last leave life light like lonely lost love low moon my never night
  nothing of on one only out over rain right river running say see sky somebody song stay sweet take tears
  the this through time together tonight under up vibe walk want way we when while white wild with without
  world year years you your`.split(/\s+/));
const spanishWords = new Set(`adios agua alma amar amor aqui ayer bailar beso besos blanca blanco buena bueno
  cancion cantar cerca cielo ciudad como con contigo corazon cuando dame del despues dia dime donde dulce el
  ella en eres es esta estrella feliz fuego gente gracias hasta hay hoy juntos la las lejos llorar lluvia loco
  los luna luz manana mar miedo mirada mujer mundo nadie negra noche nos nunca nueva ojos olvido para pero por
  porque puedo pulso que quiero recuerdo reina roja siempre sin soy sueno suenos tarde tierra triste un una vamos
  verdad vida viento vivir volver voy ya yo`.split(/\s+/));
const neuralVoices = [spanishVoice, englishVoice];
const speechText = value => String(value || '').normalize('NFC').replace(/_/g,' ').replace(/\.(mp3|wav|flac|m4a)$/i,'').trim();
const baseLanguage = code => String(code).toLowerCase().split('-')[0];

export function detectTitleLanguage(title) {
  const text = speechText(title).toLowerCase().replace(/’/g, "'");
  const words = text.normalize('NFD').replace(/\p{M}/gu, '').match(/[a-z]+(?:'[a-z]+)?/g) || [];
  const english = words.filter(word => englishWords.has(word)).length;
  const spanish = words.filter(word => spanishWords.has(word)).length + (/[áéíóúñ¿¡]/.test(text) ? 2 : 0);
  if (english === spanish) return '';
  return english > spanish ? englishVoice.lang : spanishVoice.lang;
}

export function announcement(song, settings, voices = []) {
  let text = speechText(song.pronunciation || song.title);
  const fallback = settings.voiceLang || spanishVoice.lang;
  const lang = song.speechLanguage || detectTitleLanguage(song.title) || fallback;
  const language = baseLanguage(lang);
  if (language === 'en') text=text.replace(/\bur\b/gi,'your').replace(/&/g,' and ');
  if (text===text.toUpperCase() && text.length>4) text=text.toLowerCase();
  const selectedVoice = settings.voiceURI && [...neuralVoices, ...voices].find(voice => voice.voiceURI === settings.voiceURI);
  const neuralVoice = neuralVoices.find(voice => baseLanguage(voice.lang) === language);
  const voiceURI = selectedVoice && baseLanguage(selectedVoice.lang) === language
    ? selectedVoice.voiceURI : neuralVoice?.voiceURI || '';
  return {text,settings:{...settings,voiceLang:lang,voiceURI}};
}
