'use strict';

/* ==========================================================================
   «Ход за Ходом» — весь интерактив лендинга.
   Без фреймворков и сторонних библиотек: ванильный JS + CSS-анимации.
   Текст в разметку попадает только через textContent — innerHTML не используется.
   ========================================================================== */

/* ---------- 0. Утилиты ---------- */
function $(sel, root){ return (root || document).querySelector(sel); }
function $$(sel, root){
  return Array.prototype.slice.call((root || document).querySelectorAll(sel));
}
function motionOff(){
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* Переключатели поведения */
const PLAY_MS = 1250;   /* длительность прохода фишки по дорожке */
const HOP_MS = 260;     /* длительность одного подскока */
const ROLL_MS = 850;    /* сколько «катится» кубик */
const COUNT_MS = 1400;  /* длительность анимации счётчиков */

/* ==========================================================================
   1. Параллакс в hero: миплы, кубики и звёзды летят с разной скоростью
   ========================================================================== */
(function parallax(){
  const items = $$('.parallax');
  if (!items.length || motionOff()) return;

  const layers = items.map(function(el){
    return {
      el: el,
      depth: parseFloat(el.getAttribute('data-depth')) || 0.1,
      base: 0
    };
  });

  /* Запоминаем исходное смещение, чтобы не «уехать» при повторных расчётах */
  function measure(){
    layers.forEach(function(l){
      l.base = l.el.offsetTop;
    });
  }

  let queued = false;
  function update(){
    queued = false;
    const y = window.pageYOffset;
    layers.forEach(function(l){
      const shift = (y - l.base) * l.depth;
      l.el.style.transform = 'translate3d(0,' + shift.toFixed(1) + 'px,0)';
    });
  }
  function onScroll(){
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  }

  measure();
  update();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', function(){
    measure();
    onScroll();
  });
})();

/* ==========================================================================
   2. Плавная прокрутка по якорям
   ========================================================================== */
function scrollToTarget(target){
  if (!target) return;
  if (motionOff()){ target.scrollIntoView(); return; }
  const header = $('.topbar');
  const offset = (header ? header.offsetHeight : 0) + 12;
  const top = target.getBoundingClientRect().top + window.pageYOffset - offset;
  window.scrollTo({ top: Math.max(top, 0), behavior: 'smooth' });
}

$$('a[href^="#"]').forEach(function(link){
  link.addEventListener('click', function(event){
    const href = link.getAttribute('href');
    if (!href || href === '#' || href.length < 2) return;
    const target = document.getElementById(href.slice(1));
    if (!target) return;
    event.preventDefault();
    scrollToTarget(target);
    history.replaceState(null, '', href);
  });
});

/* Активная клетка навигации при скролле */
(function navSpy(){
  const links = $$('[data-nav]');
  if (!links.length || !('IntersectionObserver' in window)) return;

  const map = {};
  const sections = [];
  links.forEach(function(link){
    const id = link.getAttribute('data-nav');
    const section = document.getElementById(id);
    if (!section) return;
    map[id] = link;
    sections.push(section);
  });

  const observer = new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      if (!entry.isIntersecting) return;
      links.forEach(function(l){ l.classList.remove('is-active'); });
      const active = map[entry.target.id];
      if (active) active.classList.add('is-active');
    });
  }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });

  sections.forEach(function(section){ observer.observe(section); });
})();

/* ==========================================================================
   3. Фишка на дорожке: прыгает по клеткам, потом ведёт к услугам
   ========================================================================== */
(function pawnTrack(){
  const start = $('#pawn-cell');
  const pawn = $('#pawn');
  const track = $('#field-track');
  if (!start || !pawn || !track) return;

  const cells = $$('.field__cell', track);
  let busy = false;

  function step(dx, dy, ms){
    return new Promise(function(resolve){
      const fromX = pawn.__x || 0;
      const fromY = pawn.__y || 0;
      const toX = fromX + dx;
      const toY = fromY + dy;
      const t0 = performance.now();

      function frame(now){
        const p = Math.min((now - t0) / ms, 1);
        pawn.__x = fromX + (toX - fromX) * p;
        pawn.__y = fromY + (toY - fromY) * p;
        /* Синусоида даёт «подскок» на каждом шаге */
        const hop = Math.sin(Math.PI * p) * Math.abs(dx) * 0.34;
        pawn.style.transform =
          'translate(' + pawn.__x.toFixed(1) + 'px,' + (pawn.__y - hop).toFixed(1) + 'px)' +
          ' rotate(' + (pawn.__x * 0.55).toFixed(1) + 'deg)';
        if (p < 1) requestAnimationFrame(frame);
        else resolve();
      }
      requestAnimationFrame(frame);
    });
  }

  start.addEventListener('click', function(){
    if (busy) return;

    if (motionOff() || cells.length < 2){
      scrollToTarget($('#services'));
      return;
    }

    busy = true;
    pawn.__x = 0;
    pawn.__y = 0;
    pawn.style.transform = 'translate(0,0)';

    const origin = cells[0].getBoundingClientRect();
    const jumps = cells.slice(1).map(function(cell){
      const box = cell.getBoundingClientRect();
      return {
        dx: (box.left + box.width / 2) - (origin.left + origin.width / 2),
        dy: (box.top + box.height / 2) - (origin.top + origin.height / 2)
      };
    });

    let chain = Promise.resolve();
    jumps.forEach(function(jump){
      chain = chain.then(function(){ return step(jump.dx, jump.dy, HOP_MS); });
    });

    chain.then(function(){
      scrollToTarget($('#services'));
      setTimeout(function(){
        pawn.__x = 0;
        pawn.__y = 0;
        pawn.style.transform = 'translate(0,0)';
        busy = false;
      }, 700);
    });
  });
})();

/* ==========================================================================
   4. Карточки каталога: раскрытие описания, hover-свет, подсветка после броска
   ========================================================================== */
const gameCards = $$('#catalog-grid .game');

function setCardOpen(card, open){
  if (!card) return;
  card.classList.toggle('is-open', open);
  const hint = $('.game__hint', card);
  if (hint) hint.textContent = open ? 'свернуть' : 'развернуть';
}

function toggleCard(card){
  if (!card) return;
  const open = !card.classList.contains('is-open');
  setCardOpen(card, open);
  /* Ручное закрытие снимает подсветку, оставшуюся от броска кубика */
  if (!open) card.classList.remove('is-rolled');
}

gameCards.forEach(function(card){
  card.addEventListener('click', function(event){
    /* Клик по кнопке брони внутри панели не должен закрывать карточку */
    if (event.target.closest('[data-open-modal]')) return;
    toggleCard(card);
  });

  /* Доступность с клавиатуры */
  card.setAttribute('tabindex', '0');
  card.addEventListener('keydown', function(event){
    if (event.key === 'Enter' || event.key === ' '){
      if (event.target.closest('[data-open-modal]')) return;
      event.preventDefault();
      toggleCard(card);
    }
  });
});

/* Курсорное световое пятно на интерактивных карточках */
(function cursorGlow(){
  if (motionOff()) return;
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  const targets = $$('.game, .service, .rate, .shot, .track__step');
  targets.forEach(function(el){
    el.addEventListener('pointermove', function(event){
      const box = el.getBoundingClientRect();
      el.style.setProperty('--mx', (event.clientX - box.left) + 'px');
      el.style.setProperty('--my', (event.clientY - box.top) + 'px');
    });
  });
})();

/* ==========================================================================
   5. Кубик: анимированный SVG-кубик и случайная игра
   ========================================================================== */
const FACES = [1, 2, 3, 4, 5, 6];

const dice = $('#dice');
const diceArt = $('#dice-art');
const diceNote = $('#dice-note');
let rolling = false;

/* Иконка в кнопке «Бросить кубик»: своя копия ссылки на символ */
const btnDie = $('.btn__art use[data-show]');
showFaceIcon(5);

function showFaceIcon(value){
  if (btnDie) btnDie.setAttribute('data-show', String(value));
}

/* Грань переключается атрибутом hidden на группах внутри <symbol>:
   <use> отрисовывает их теневую копию, а до неё не достают ни селекторы,
   ни inline-стили — зато видно изменение атрибутов в самом спрайте. */
const diceFaces = $$('#dice-faces .die-face');

function showFace(value){
  const face = FACES.indexOf(value) === -1 ? 1 : value;
  diceFaces.forEach(function(group){
    if (parseInt(group.getAttribute('data-f'), 10) === face) group.removeAttribute('hidden');
    else group.setAttribute('hidden', '');
  });
  if (diceArt) diceArt.setAttribute('data-face', String(face));
  /* Кнопка всё время показывает выпавшую грань */
  showFaceIcon(face);
}

const rollBtn = $('#roll-dice');
if (rollBtn && dice && diceArt && gameCards.length){
  showFace(1);

  rollBtn.addEventListener('click', function(){
    if (rolling) return;
    rolling = true;
    rollBtn.disabled = true;

    const target = gameCards[Math.floor(Math.random() * gameCards.length)];
    const value = 1 + Math.floor(Math.random() * 6);

    /* Повторный бросок: закрываем прошлую карточку и снимаем подсветку */
    gameCards.forEach(function(card){
      card.classList.remove('is-rolled');
      setCardOpen(card, false);
    });

    if (motionOff()){
      showFace(value);
      if (diceNote) diceNote.textContent = 'Выпало ' + value + '. ' + target.getAttribute('data-game') + ' — хороший выбор!';
      finishRoll(target);
      return;
    }

    dice.hidden = false;
    dice.classList.remove('is-landed');
    dice.classList.add('is-rolling');

    /* Во время «катания» перебираем грани */
    const spinner = setInterval(function(){
      showFace(1 + Math.floor(Math.random() * 6));
    }, 85);

    setTimeout(function(){
      clearInterval(spinner);
      dice.classList.remove('is-rolling');
      dice.classList.add('is-landed');

      /* Кубик «падает» на выпавшую грань */
      showFace(value);

      if (diceNote){
        diceNote.textContent = 'Выпало ' + value + '. ' +
          target.getAttribute('data-game') + ' — с неё и начнём!';
      }
      finishRoll(target);
    }, ROLL_MS);

    function finishRoll(card){
      setCardOpen(card, true);
      card.classList.add('is-rolled');
      card.scrollIntoView({ behavior: motionOff() ? 'auto' : 'smooth', block: 'center' });
      setTimeout(function(){
        rolling = false;
        rollBtn.disabled = false;
      }, 900);
    }
  });
}

/* ==========================================================================
   6. Счётчики в hero: 0 → 150 / 418 / 2 при первом появлении
   ========================================================================== */
(function counters(){
  const numbers = $$('.fact__num');
  if (!numbers.length) return;

  function render(el, value){
    el.textContent = value.toLocaleString('ru-RU');
  }

  function run(el){
    const to = parseInt(el.getAttribute('data-count'), 10) || 0;
    if (motionOff()){
      render(el, to);
      return;
    }
    const t0 = performance.now();
    function frame(now){
      const p = Math.min((now - t0) / COUNT_MS, 1);
      const eased = 1 - Math.pow(1 - p, 3); /* easeOutCubic */
      render(el, Math.round(to * eased));
      if (p < 1) requestAnimationFrame(frame);
      else render(el, to);
    }
    requestAnimationFrame(frame);
  }

  numbers.forEach(function(el){ render(el, 0); });

  function runAll(){ numbers.forEach(run); }

  if (!('IntersectionObserver' in window)){
    runAll();
    return;
  }
  try {
    const observer = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if (!entry.isIntersecting) return;
        run(entry.target);
        observer.unobserve(entry.target);
      });
    }, { threshold: .5 });
    numbers.forEach(function(el){ observer.observe(el); });
  } catch (error){
    runAll();
  }
})();

/* ==========================================================================
   7. Появление секций при скролле + «рисование» линии дорожки
   ========================================================================== */
(function reveals(){
  const items = $$('[data-reveal]');
  const track = $('#track');

  function showAll(){
    items.forEach(function(el){ el.classList.add('is-visible'); });
    if (track) track.classList.add('is-drawn');
  }

  if (motionOff() || !('IntersectionObserver' in window)){
    showAll();
    return;
  }

  let observer;
  try {
    observer = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: .12 });

    items.forEach(function(el){ observer.observe(el); });
  } catch (error){
    /* Если наблюдатель недоступен, контент обязан быть видимым */
    showAll();
    return;
  }

  /* Линия дорожки «рисуется» слева направо, когда шаги попали во вьюпорт */
  if (track){
    try {
      const lineObserver = new IntersectionObserver(function(entries){
        entries.forEach(function(entry){
          if (!entry.isIntersecting) return;
          track.classList.add('is-drawn');
          lineObserver.unobserve(entry.target);
        });
      }, { threshold: .2 });
      lineObserver.observe(track);
    } catch (error){
      track.classList.add('is-drawn');
    }
  }
})();

/* ==========================================================================
   8. Модалка: две вкладки («Прокат» / «Антикафе»), фокус-ловушка, Esc
   ========================================================================== */
const modal = $('#modal');
const modalTitle = $('#modal-title');
const modalLead = $('#modal-lead');
const tabs = $$('.tab');
const panels = {
  rent: $('#panel-rent'),
  cafe: $('#panel-cafe')
};
let lastFocused = null;

const MODAL_COPY = {
  rent: {
    topic: 'rent',
    title: 'Открыть коробку',
    lead: 'Оставь контакты — свяжемся в течение часа и подтвердим бронь.'
  },
  cafe: {
    topic: 'cafe',
    title: 'Забронировать столик',
    lead: 'Напиши, когда планируете прийти, — придержим столик и подберём игры.'
  }
};

function setTab(name, focus){
  if (!panels.rent || !panels.cafe) return;
  const key = name === 'cafe' ? 'cafe' : 'rent';

  tabs.forEach(function(tab){
    const active = tab.getAttribute('data-tab') === key;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
    if (active && focus) tab.focus();
  });

  Object.keys(panels).forEach(function(k){
    const panel = panels[k];
    const active = k === key;
    panel.hidden = !active;
    panel.classList.toggle('is-active', active);
  });

  const copy = MODAL_COPY[key];
  const topicField = $('#modal-topic', panels.rent);
  if (topicField) topicField.value = copy.topic;
  if (modalTitle) modalTitle.textContent = copy.title;
  if (modalLead) modalLead.textContent = copy.lead;
}

if (modal && tabs.length){
  tabs.forEach(function(tab){
    tab.addEventListener('click', function(){ setTab(tab.getAttribute('data-tab'), false); });
    tab.addEventListener('keydown', function(event){
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const next = tab.getAttribute('data-tab') === 'rent' ? 'cafe' : 'rent';
      setTab(next, true);
    });
  });
  setTab('rent', false);
}

function focusables(root){
  return $$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', root)
    .filter(function(el){ return el.offsetParent !== null; });
}

function openModal(topic, game){
  if (!modal) return;
  lastFocused = document.activeElement;
  setTab(topic === 'cafe' ? 'cafe' : 'rent', false);

  const gameInput = $('#m-game');
  if (gameInput){
    gameInput.value = game || '';
    /* Подсвечиваем автоподставленное название игры */
    gameInput.classList.add('is-prefilled');
  }

  modal.hidden = false;
  document.body.style.overflow = 'hidden';

  setTimeout(function(){
    const first = focusables(modal)[0];
    if (first) first.focus();
  }, 60);

  document.addEventListener('keydown', onModalKeydown);
}

function closeModal(){
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  document.body.style.overflow = '';
  document.removeEventListener('keydown', onModalKeydown);
  if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
}

function onModalKeydown(event){
  if (!modal || modal.hidden) return;
  if (event.key === 'Escape'){ event.preventDefault(); closeModal(); return; }
  if (event.key !== 'Tab') return;

  const items = focusables(modal);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];

  if (event.shiftKey && document.activeElement === first){
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last){
    event.preventDefault();
    first.focus();
  }
}

$$('[data-open-modal]').forEach(function(btn){
  btn.addEventListener('click', function(){
    openModal(btn.getAttribute('data-topic'), btn.getAttribute('data-game'));
  });
});
$$('[data-close-modal]').forEach(function(el){
  el.addEventListener('click', closeModal);
});

/* ==========================================================================
   9. Формы: маска телефона, валидация с «тряской», штамп, переворот записки
   ========================================================================== */
function setError(field, message){
  if (!field) return;
  const error = $('[data-error-for="' + field.id + '"]');
  if (error) error.textContent = message || '';
  field.setAttribute('aria-invalid', message ? 'true' : 'false');
}

function shake(field){
  const box = field ? field.closest('.field') : null;
  if (!box || motionOff()) return;
  box.classList.remove('is-shake');
  /* reflow, чтобы анимация перезапустилась */
  void box.offsetWidth;
  box.classList.add('is-shake');
  setTimeout(function(){ box.classList.remove('is-shake'); }, 320);
}

/* --- Маска телефона: +7 (999) 123-45-67 --- */
function maskPhone(value){
  let digits = String(value).replace(/\D/g, '');
  if (digits.charAt(0) === '8') digits = '7' + digits.slice(1);
  if (digits.charAt(0) !== '7') digits = '7' + digits;
  digits = digits.slice(0, 11);

  const rest = digits.slice(1);
  let out = '+7';
  if (rest.length) out += ' (' + rest.slice(0, 3);
  if (rest.length > 3) out += ')';
  if (rest.length > 3) out += ' ' + rest.slice(3, 6);
  if (rest.length > 6) out += '-' + rest.slice(6, 8);
  if (rest.length > 8) out += '-' + rest.slice(8, 10);
  return out;
}

$$('input[type="tel"]').forEach(function(input){
  input.addEventListener('input', function(){
    input.value = maskPhone(input.value);
    if (input.getAttribute('aria-invalid') === 'true') validateField(input);
  });
  input.addEventListener('focus', function(){
    if (!input.value) input.value = '+7 (';
  });
  input.addEventListener('blur', function(){
    if (input.value.replace(/\D/g, '').length <= 1) input.value = '';
  });
});

/* --- Валидация одного поля --- */
function validateField(field){
  if (!field) return true;
  if (!field.willValidate && !field.hasAttribute('required')) return true;
  const value = (field.value || '').trim();

  if (field.type === 'tel'){
    const digits = value.replace(/\D/g, '');
    if (!digits){
      setError(field, 'Оставь номер — перезвоним');
      return false;
    }
    if (digits.length < 11){
      setError(field, 'Номер неполный: нужно 11 цифр');
      return false;
    }
    setError(field, '');
    return true;
  }

  if (field.required && !value){
    setError(field, 'Заполни это поле');
    return false;
  }
  const min = parseInt(field.getAttribute('minlength') || '0', 10);
  if (min && value.length < min){
    setError(field, 'Слишком коротко — минимум ' + min + ' символа');
    return false;
  }
  if (field.type === 'number' && value){
    const num = parseInt(value, 10);
    const minNum = parseInt(field.getAttribute('min') || '0', 10);
    if (isNaN(num) || num < minNum){
      setError(field, 'Минимум ' + minNum);
      return false;
    }
  }
  setError(field, '');
  return true;
}

function attachValidation(form, noteEl, onDone){
  if (!form) return;
  const fields = $$('input:not([type="hidden"]), select, textarea', form);

  fields.forEach(function(field){
    field.addEventListener('blur', function(){ validateField(field); });
    field.addEventListener('input', function(){
      if (field.getAttribute('aria-invalid') === 'true') validateField(field);
    });
  });

  form.addEventListener('submit', function(event){
    event.preventDefault();
    let ok = true;
    let firstInvalid = null;

    fields.forEach(function(field){
      if (!validateField(field)){
        ok = false;
        shake(field);
        if (!firstInvalid) firstInvalid = field;
      }
    });

    if (!ok){
      if (noteEl) noteEl.textContent = 'Почти готово — проверь подсвеченные поля.';
      if (firstInvalid) firstInvalid.focus();
      return;
    }

    if (noteEl) noteEl.textContent = '';
    if (onDone) onDone(form);
  });
}

/* --- Записка: штамп «Отправлено!» + переворот --- */
const note = $('#note');
const noteStamp = $('#note-stamp');

attachValidation($('#contact-form'), $('#form-note'), function(form){
  if (noteStamp && !motionOff()){
    noteStamp.classList.remove('is-on');
    void noteStamp.offsetWidth;
    noteStamp.classList.add('is-on');
    setTimeout(function(){ noteStamp.classList.remove('is-on'); }, 2000);
  }

  const delay = motionOff() ? 120 : 1700;
  setTimeout(function(){
    if (note) note.classList.add('is-flipped');
    const back = note ? $('.note__side--back', note) : null;
    if (back){
      const btn = $('button', back);
      if (btn) btn.focus();
    }
  }, delay);

  form.reset();
  $$('input, select, textarea', form).forEach(function(field){ setError(field, ''); });
});

const noteBack = $('#note-back');
if (noteBack){
  noteBack.addEventListener('click', function(){
    if (note) note.classList.remove('is-flipped');
    const first = $('#f-name');
    if (first) first.focus();
  });
}

/* --- Форма проката в модалке --- */
attachValidation($('#modal-form'), $('#modal-note'), function(){
  closeModal();
});

/* --- Форма антикафе в модалке --- */
attachValidation($('#cafe-form'), $('#cafe-note'), function(form){
  const noteEl = $('#cafe-note');
  if (noteEl){
    noteEl.textContent = 'Столик забронирован. Ждём вас — напитки уже греются.';
  }
  form.reset();
});
