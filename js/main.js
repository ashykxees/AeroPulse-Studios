document.addEventListener('DOMContentLoaded', () => {
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
