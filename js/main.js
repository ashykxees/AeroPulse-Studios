document.addEventListener('DOMContentLoaded', () => {
  // Intro animation
  const intro = document.getElementById('intro');
  const hero = document.querySelector('.hero');

  if (intro) {
    const seenIntro = sessionStorage.getItem('aeropulseIntroSeen');

    if (seenIntro) {
      intro.classList.add('hidden');
      if (hero) hero.classList.add('revealed');
    } else {
      window.addEventListener('load', () => {
        setTimeout(() => {
          intro.classList.add('animate-out');
          setTimeout(() => {
            intro.classList.add('hidden');
            sessionStorage.setItem('aeropulseIntroSeen', 'true');
          }, 1400);
        }, 2200);

        if (hero) {
          setTimeout(() => hero.classList.add('revealed'), 2400);
        }
      });
    }
  } else if (hero) {
    hero.classList.add('revealed');
  }

  // Mobile menu toggle
  const menuBtn = document.querySelector('.mobile-menu-btn');
  const mobileMenu = document.getElementById('mobileMenu');

  if (menuBtn && mobileMenu) {
    menuBtn.addEventListener('click', () => {
      mobileMenu.classList.toggle('open');
    });

    mobileMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => mobileMenu.classList.remove('open'));
    });
  }

  // Game filters
  const filterBtns = document.querySelectorAll('.filter-btn');
  const gameCards = document.querySelectorAll('#gamesGrid .card');

  if (filterBtns.length && gameCards.length) {
    filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const filter = btn.dataset.filter;
        gameCards.forEach(card => {
          const status = card.dataset.status;
          card.style.display = (filter === 'all' || status === filter) ? '' : 'none';
        });
      });
    });
  }

  // Pre-select contact type from URL
  const params = new URLSearchParams(window.location.search);
  const typeParam = params.get('type');
  const typeSelect = document.getElementById('type');

  if (typeSelect && typeParam) {
    const option = Array.from(typeSelect.options).find(opt => opt.value === typeParam);
    if (option) typeSelect.value = typeParam;
  }

  // Contact form handling
  const contactForm = document.getElementById('contactForm');

  if (contactForm) {
    contactForm.addEventListener('submit', e => {
      e.preventDefault();
      const btn = contactForm.querySelector('button[type="submit"]');
      const original = btn.textContent;
      btn.textContent = 'Sent!';
      btn.disabled = true;
      setTimeout(() => {
        btn.textContent = original;
        btn.disabled = false;
        contactForm.reset();
      }, 2500);
    });
  }
});
