/* ===========================================
   BỘ ĐIỀU KHIỂN TRÌNH CHIẾU (dùng chung mọi deck hướng dẫn)
   Phím ←/→/Space/PgUp/PgDn, lăn chuột, vuốt chạm, bấm chấm tiến trình
   =========================================== */
class SlidePresentation {
    constructor() {
        this.slides = document.querySelectorAll('.slide');
        this.stage = document.getElementById('deckStage');
        this.current = 0;
        this.buildDots();
        this.setupNavButtons();
        this.setupStageScale();
        this.setupKeyboard();
        this.setupWheel();
        this.setupTouch();
        this.show(0);
    }
    setupNavButtons() {
        this.btnPrev = document.getElementById('btnPrev');
        this.btnNext = document.getElementById('btnNext');
        this.btnPrev.addEventListener('click', () => this.show(this.current - 1));
        this.btnNext.addEventListener('click', () => this.show(this.current + 1));
    }
    setupStageScale() {
        const scale = () => {
            const k = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
            const x = (window.innerWidth - 1920 * k) / 2;
            const y = (window.innerHeight - 1080 * k) / 2;
            this.stage.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
        };
        scale();
        window.addEventListener('resize', scale);
    }
    buildDots() {
        const wrap = document.getElementById('deckDots');
        this.dots = [...this.slides].map((_, i) => {
            const b = document.createElement('button');
            b.className = 'pdot';
            b.setAttribute('aria-label', `Slide ${i + 1}`);
            b.addEventListener('click', () => this.show(i));
            wrap.appendChild(b);
            return b;
        });
    }
    setupKeyboard() {
        document.addEventListener('keydown', (e) => {
            if (e.target.getAttribute && e.target.getAttribute('contenteditable')) return;
            if (['ArrowRight', ' ', 'PageDown'].includes(e.key)) { e.preventDefault(); this.show(this.current + 1); }
            if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); this.show(this.current - 1); }
            if (e.key === 'Home') this.show(0);
            if (e.key === 'End') this.show(this.slides.length - 1);
        });
    }
    setupWheel() {
        let lock = 0;
        window.addEventListener('wheel', (e) => {
            const now = Date.now();
            if (now - lock < 650 || Math.abs(e.deltaY) < 12) return;
            lock = now;
            this.show(this.current + (e.deltaY > 0 ? 1 : -1));
        }, { passive: true });
    }
    setupTouch() {
        let x0 = null;
        window.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
        window.addEventListener('touchend', (e) => {
            if (x0 === null) return;
            const dx = e.changedTouches[0].clientX - x0;
            if (Math.abs(dx) > 60) this.show(this.current + (dx < 0 ? 1 : -1));
            x0 = null;
        }, { passive: true });
    }
    show(i) {
        this.current = Math.max(0, Math.min(i, this.slides.length - 1));
        this.slides.forEach((s, k) => {
            s.classList.toggle('active', k === this.current);
            s.classList.toggle('visible', k === this.current);
        });
        this.dots.forEach((d, k) => d.classList.toggle('on', k === this.current));
        // Đầu/cuối đường thì mờ nút tương ứng
        this.btnPrev.disabled = this.current === 0;
        this.btnNext.disabled = this.current === this.slides.length - 1;
    }
}
const deck = new SlidePresentation();

/* ===========================================
   CHẾ ĐỘ SỬA CHỮ TRỰC TIẾP (phím E)
   Sửa xong tự lưu localStorage; Ctrl+S tải file HTML đã sửa
   =========================================== */
const editor = {
    isActive: false,
    // Khoá lưu riêng theo từng deck để không giẫm lên nhau
    key: 'hubsell-guide-edits:' + location.pathname,
    toggleEditMode() {
        this.isActive = !this.isActive;
        document.body.classList.toggle('editing', this.isActive);
        document.getElementById('editToggle').classList.toggle('active', this.isActive);
        document.querySelectorAll('.slide h1,.slide h2,.slide h3,.slide h4,.slide p,.slide span,.slide b,.slide div.crumb')
            .forEach(el => {
                if (this.isActive) el.setAttribute('contenteditable', 'true');
                else el.removeAttribute('contenteditable');
            });
        if (!this.isActive) this.save();
    },
    save() {
        localStorage.setItem(this.key, document.getElementById('deckStage').innerHTML);
    }
};
const hotzone = document.querySelector('.edit-hotzone');
const editToggle = document.getElementById('editToggle');
let hideTimeout = null;
hotzone.addEventListener('mouseenter', () => { clearTimeout(hideTimeout); editToggle.classList.add('show'); });
hotzone.addEventListener('mouseleave', () => { hideTimeout = setTimeout(() => { if (!editor.isActive) editToggle.classList.remove('show'); }, 400); });
editToggle.addEventListener('mouseenter', () => clearTimeout(hideTimeout));
editToggle.addEventListener('mouseleave', () => { hideTimeout = setTimeout(() => { if (!editor.isActive) editToggle.classList.remove('show'); }, 400); });
editToggle.addEventListener('click', () => editor.toggleEditMode());
hotzone.addEventListener('click', () => editor.toggleEditMode());
document.addEventListener('keydown', (e) => {
    if ((e.key === 'e' || e.key === 'E') && !(e.target.getAttribute && e.target.getAttribute('contenteditable'))) editor.toggleEditMode();
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        editor.save();
        const blob = new Blob(['<!DOCTYPE html>' + document.documentElement.outerHTML], { type: 'text/html' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = location.pathname.split('/').pop() || 'huong-dan-hubsell.html';
        a.click();
    }
});
