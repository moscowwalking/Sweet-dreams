document.addEventListener('DOMContentLoaded', () => {
  const type = document.body.dataset.emojis;

  // Наборы эмоджи по типу
  const emojiSets = {
    concert: ['🎤', '🎶', '🎧', '🎸', '🥁', '🎹', '🎷', '🎼', '💃', '🕺','😎','🔥',],
    love: ['💖', '💘', '🥰', '💕', '💗', '❤️', '💋', '😍', '💓', '💞'],
    flowers: ['🌸', '🌺', '🌹', '🌷', '🌼', '💐', '🪻', '🌻', '🪷', '🌿'],
    study: ['📚', '📖', '📝', '🧠', '🎓', '📊', 'КРАСНЫЙ ДИПЛОМ','ДИПЛОООООМММ','КРААААСНЫЙ','УРААА','🛑','📕','🔴','🟥','🔺','🔻'],
    muslim: ['🕌', '🌙', '✨', '🧕', '🧔', '🧴', '🌴', '🕌', '🕌', '🕌', '🕌', '📿', '🕌', '🥙', '🧆', '☪️','IRAN','IRAN','🇮🇷','🇮🇷'],
    main:  ['💖', '🎂', '🎁', '🎉', '🥳', '✨', '🎈', '💐','🍰','💝','💕','💗','❤️','🌸','💫','✨']
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
