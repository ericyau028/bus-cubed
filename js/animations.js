(function() {
  'use strict';
  if (!window.IntersectionObserver) return;

  function animateOnScroll() {
    var els = document.querySelectorAll('.reveal, .reveal-up, .reveal-stagger');
    if (!els.length) return;
    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
    els.forEach(function(el) { observer.observe(el); });
  }

  function staggerReveal(container) {
    var children = container.querySelectorAll('.reveal-stagger > *');
    children.forEach(function(child, i) {
      child.style.setProperty('--delay', i * 0.08 + 's');
    });
  }

  document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('.reveal-stagger').forEach(staggerReveal);
    animateOnScroll();
  });
})();

(function() {
  var nav = document.querySelector('nav');
  if (!nav) return;
  var ticking = false;
  window.addEventListener('scroll', function() {
    if (!ticking) {
      window.requestAnimationFrame(function() {
        if (window.scrollY > 80) nav.classList.add('nav-shrunk');
        else nav.classList.remove('nav-shrunk');
        ticking = false;
      });
      ticking = true;
    }
  });
})();

document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('a[href^="#"]').forEach(function(a) {
    a.addEventListener('click', function(e) {
      var target = document.querySelector(this.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
});
