/**
 * The UI language of an e2e run (NG_LANG=ru npm run e2e:...; default English), stored in the save like a player's
 * choice (there is no URL parameter or debug hook for it), and the menu labels the scripts tap, per language.
 */
const LANG = process.env.NG_LANG === 'ru' ? 'ru' : 'en';
const RU = {
  PLAY: 'ИГРАТЬ', HERO: 'ГЕРОЙ', WISP: 'ОГОНЁК', SETTINGS: 'НАСТРОЙКИ', 'SCREEN SHAKE': 'ТРЯСКА ЭКРАНА', 'BEST SCORES': 'РЕКОРДЫ',
  BOARD: 'РЕЙТИНГ', RESUME: 'ПРОДОЛЖИТЬ', SUBMITTED: 'ОТПРАВЛЕНО', MASTER: 'ГРОМКОСТЬ', 'TOUCH CONTROLS': 'СЕНСОР', 'TOUCH SMOOTHING': 'СГЛАЖИВАНИЕ', 'QUIT TO TITLE': 'В ГЛАВНОЕ МЕНЮ', 'TOUCH CONTROLS STICK': 'СЕНСОР: СТИК', 'TOUCH CONTROLS DRAG': 'СЕНСОР: ВЕДЕНИЕ ПАЛЬЦЕМ',
};
/** A label as the game shows it in the run's language. */
const L = (s) => (LANG === 'ru' ? (RU[s] ?? s) : s);
module.exports = { LANG, L };
