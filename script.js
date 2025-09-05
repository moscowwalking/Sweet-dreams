document.addEventListener('DOMContentLoaded', () => {
  const type = document.body.dataset.emojis;

  // Наборы эмоджи по типу
  const emojiSets = {
    concert: ['🎤', '🎶', '🎧', '🎸', '🥁', '🎹', '🎷', '🎼', '💃', '🕺','😎','🔥',],
    love: ['💖', '👼', '🥰', '💕', '❤️', '🌺', '👼🏿', '😍', '💓', '💞', '☺️','💋','вечером свободна?','утром свободна?','днем свободна?','Приветик красотка😍😍'],
    flowers: ['🌸', '🌺', '🌹', '🌷', '🌼', '💐', '🌻', '🌿','не опаздывай','50 рублей не забудь взять','кто опоздает тот лох','привет как дела?'],
    egor: ['💋', '😎', '🔥', '😍', '😘', '👑', '🖤', '💄', '🕶️', '🤳'],
    parking:['Грибочкииии','Лисичкиии','Поганки((','🍄','🌲','🐿️','🌳','🦔','🌿','☀️','🐇','мухомооор'],
    time: ['🗓️', '⏰', '🕒', '📅', '🕘', '📆', '💖', '❣️', 'когда тебе удобно?', 'выбирай 🕒'],
    sad:['😢', '😭', '😞', '😔', '💔', '🥺', '😩', '🙁', '💧','💦','жизнь боль...','депресия в 0 лет...','почему(why)...','за окном rain...','на душе pain...',],
    choise: [
    '🌸', '🍃', '👼',  '✨', '😍', '👼', 
    '😳', '🫶', '🍭',  '🍷',  '🤍', '✨',
    '🎉', '🫠',  '💫', '⭐', '🌈', '🎁', 'Поход в горы???','Ты такая красивая...','Челябинск???','Тверь???','место встречи...','Москоуу???','Питеррр???'],
    choise_moscow: [
    '🌸', '🟥', '👼',  '✨', '😍', '👼', 
    '😳', '🌆', '🏙️',  '🍷',  '🤍', '✨',
    '🎉', '⛪',  '💫', '⭐', '🌈', '🎁', 'Вот бы тут жить...','Ты такая красивая...','За Москвой так красиво','','...','','???'],
    choise_SP: [
    '🌸', '🌉', '👼',  '✨', '😍', '👼', 
    '🚢', '🫶', '🏰',  '🍷',  '🤍', '✨',
    '🎨 ', '🚆',  '💫', '⭐', '❣️', '🌊', '52','Ты такая красивая...','Ты святая как питер','В питере семья','В питере душа','В питере ❤️','Да здравствует Петербург'],
  };

  const emojis = emojiSets[type] || emojiSets.hearts; // fallback на hearts

  // Создание контейнера
  const heartsContainer = document.createElement('div');
  heartsContainer.classList.add('hearts-container');
  document.body.appendChild(heartsContainer);

  // Падающий эмоджи
  function createEmoji() {
    const emoji = document.createElement('div');
    emoji.classList.add('falling-emoji');
    emoji.innerText = emojis[Math.floor(Math.random() * emojis.length)];
    emoji.style.left = Math.random() * 100 + 'vw';
    emoji.style.animationDuration = (2 + Math.random() * 3) + 's';
    emoji.style.fontSize = (20 + Math.random() * 30) + 'px';
    emoji.style.top = '-50px';
    heartsContainer.appendChild(emoji);
    setTimeout(() => emoji.remove(), 5000);
  }

  setInterval(createEmoji, 300);
});
