// When the view changes, each card flies from where it was to where it goes.
//
// The old faces are copied into a layer above the page just before React swaps
// the layouts, then each copy springs to its card's new place and hands over
// to the real one. Copies can't be clipped by the new layout's own edges, and
// no layout needs to know about any of this.
import React from 'react';
import { animate } from 'motion/react';

const MAX_WAIT = 12; // frames for a new layout to measure itself and draw

const visible = (el) => {
  const r = el.getBoundingClientRect();
  if (r.width < 8 || r.bottom < -40 || r.top > window.innerHeight + 40 || r.right < -40 || r.left > window.innerWidth + 40) return null;
  if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true })) return null;
  return r;
};

// card id -> its largest face on screen
function faces(root) {
  const found = new Map();
  root.querySelectorAll('.cf[data-card]').forEach((el, order) => {
    const rect = visible(el);
    if (!rect) return;
    const prior = found.get(el.dataset.card);
    if (!prior || rect.width > prior.rect.width) found.set(el.dataset.card, { el, rect, order });
  });
  return found;
}

const stackOrder = ({ el, order }) => {
  const holder = el.closest('.cc-wallet-card, .cc-deck-card');
  return (Number(holder && getComputedStyle(holder).zIndex) || 0) * 100 + order;
};

export default class FlightStage extends React.Component {
  root = React.createRef();

  flights = new Map(); // card id -> { ghost, target, control }

  componentWillUnmount() { this.finish(); }

  getSnapshotBeforeUpdate(prev) {
    if (prev.view === this.props.view) return null;
    if (!this.props.enabled) return null;
    const copies = new Map();
    // A card still in the air keeps going from where it is.
    this.flights.forEach(({ ghost }, id) => copies.set(id, { rect: ghost.getBoundingClientRect(), node: ghost.firstChild.cloneNode(true) }));
    faces(this.root.current).forEach(({ el, rect }, id) => { if (!copies.has(id)) copies.set(id, { rect, node: el.cloneNode(true) }); });
    return copies;
  }

  componentDidUpdate(prev, state, copies) {
    if (!copies) return;
    this.finish();
    const root = this.root.current;
    const layer = document.createElement('div');
    layer.className = 'cc-ghosts';
    layer.setAttribute('aria-hidden', 'true');
    document.body.append(layer);
    this.layer = layer;
    // Copies cover the old places at once, so there is no empty frame.
    copies.forEach((copy) => {
      copy.ghost = document.createElement('div');
      copy.ghost.className = 'cc-ghost';
      copy.ghost.append(copy.node);
      Object.assign(copy.ghost.style, { left: `${copy.rect.left}px`, top: `${copy.rect.top}px`, width: `${copy.rect.width}px` });
      layer.append(copy.ghost);
    });
    root.classList.add('cc-flying');
    const stop = () => this.finish();
    window.addEventListener('wheel', stop, { passive: true, once: true });
    window.addEventListener('touchmove', stop, { passive: true, once: true });
    this.unlisten = () => { window.removeEventListener('wheel', stop); window.removeEventListener('touchmove', stop); };
    let frames = 0;
    const wait = () => {
      this.frame = requestAnimationFrame(() => {
        // Shown only for the moment it takes to measure; nothing is painted yet.
        root.classList.remove('cc-flying');
        const targets = faces(root);
        root.classList.add('cc-flying');
        frames += 1;
        if (!targets.size && frames < MAX_WAIT) wait(); else this.launch(copies, targets);
      });
    };
    wait();
  }

  launch(copies, targets) {
    const root = this.root.current;
    root.classList.remove('cc-flying');
    root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 360, easing: 'ease-out' });
    root.querySelectorAll('.cc-tab, .cc-tile-body, .cc-row-head > :not(.cc-thumb), .cc-deck-nav').forEach((el, i) => {
      el.animate([{ opacity: 0, translate: '0 10px' }, { opacity: 1, translate: '0 0' }], { duration: 380, delay: Math.min(i, 14) * 28, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
    });
    copies.forEach((copy, id) => {
      if (!targets.has(id)) {
        copy.ghost.animate([{ opacity: 1 }, { opacity: 0, scale: '0.9' }], { duration: 220, easing: 'ease-out', fill: 'forwards' }).onfinish = () => this.drop(copy.ghost);
      }
    });
    let i = 0;
    targets.forEach((target, id) => {
      const copy = copies.get(id);
      const delay = Math.min(i, 12) * 0.03;
      i += 1;
      if (!copy) {
        target.el.animate([{ opacity: 0, scale: '0.85', translate: '0 24px' }, { opacity: 1, scale: '1', translate: '0 0' }], { duration: 420, delay: delay * 1000, easing: 'cubic-bezier(.2,.9,.25,1.1)', fill: 'backwards' });
        return;
      }
      this.fly(id, copy, target, delay, i);
    });
  }

  fly(id, { ghost, rect: from }, target, delay, i) {
    const to = target.rect;
    // Drawn at the larger of the two sizes and scaled down, so it stays sharp.
    const width = Math.max(from.width, to.width);
    const height = (width * 53.98) / 85.6;
    Object.assign(ghost.style, { left: '0px', top: '0px', width: `${width}px`, zIndex: stackOrder(target) });
    target.el.style.opacity = '0';
    const lean = (i % 2 ? 1 : -1) * 5;
    const draw = (p) => {
      const arc = Math.sin(Math.PI * Math.min(1, Math.max(0, p)));
      const mix = (a, b) => a + (b - a) * p;
      ghost.style.transform = `translate(${mix(from.left, to.left)}px, ${mix(from.top, to.top) - arc * 26}px) rotate(${arc * lean}deg) scale(${mix(from.width, to.width) / width}, ${mix(from.height, to.height) / height})`;
    };
    draw(0);
    const control = animate(0, 1, {
      type: 'spring', stiffness: 170, damping: 21, mass: 0.9, delay, onUpdate: draw,
      onComplete: () => this.land(id),
    });
    this.flights.set(id, { ghost, target: target.el, control });
  }

  land(id) {
    const flight = this.flights.get(id);
    if (!flight) return;
    this.flights.delete(id);
    flight.target.style.opacity = '';
    flight.ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 110, fill: 'forwards' }).onfinish = () => this.drop(flight.ghost);
  }

  drop(ghost) {
    ghost.remove();
    if (this.layer && !this.flights.size && !this.layer.childElementCount) this.finish();
  }

  finish() {
    cancelAnimationFrame(this.frame);
    this.unlisten?.();
    this.flights.forEach(({ target, control }) => { control.stop(); target.style.opacity = ''; });
    this.flights.clear();
    this.layer?.remove();
    this.layer = null;
    this.root.current?.classList.remove('cc-flying');
  }

  render() {
    return <div ref={this.root} className="cc-stage">{this.props.children}</div>;
  }
}
