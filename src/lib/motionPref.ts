/* ============================================================================
   MOTION PREFERENCE

   The OS "reduce motion" setting is the default, but a visitor can choose
   for this site: full motion or reduced, remembered across visits.

   The choice has to be in force before ANY app code runs — GSAP, Lenis, the
   device tier and the canvas all read `prefers-reduced-motion` once at
   startup. So it is applied by a tiny inline script in <head> (MOTION_BOOT)
   that runs before hydration:
   - sets <html data-motion="full|reduced">, which the CSS honours, and
   - answers `matchMedia('(prefers-reduced-motion: …)')` with the chosen
     value, so every JS reader agrees without knowing this file exists.
     Only the motion feature is swapped (for an always-true or always-false
     width test); the rest of a compound query, such as a min-width, is
     still the browser's to answer, live.
   Changing the choice reloads the page: every timeline is built for one
   mode, and rebuilding them live is not worth the risk of a half-switched
   page.
   ========================================================================= */

export const MOTION_KEY = 'cryo-motion';

export type MotionChoice = 'system' | 'full' | 'reduced';

export const MOTION_BOOT = `(function(){try{
var c=localStorage.getItem('${MOTION_KEY}');
if(c!=='full'&&c!=='reduced')return;
document.documentElement.setAttribute('data-motion',c);
var real=window.matchMedia.bind(window);
window.matchMedia=function(q){
if(q.indexOf('prefers-reduced-motion')<0)return real(q);
return real(q.replace(/\\(\\s*prefers-reduced-motion\\s*:\\s*(no-preference|reduce)\\s*\\)/g,function(_,v){
return (v==='reduce')===(c==='reduced')?'(min-width: 0px)':'(max-width: 0px)';}));
};
}catch(e){}})();`;

export function getMotionChoice(): MotionChoice {
  try {
    const c = localStorage.getItem(MOTION_KEY);
    return c === 'full' || c === 'reduced' ? c : 'system';
  } catch {
    return 'system';
  }
}

/** Whether motion is currently reduced, after the visitor's choice. */
export function motionIsReduced() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function setMotionChoice(choice: MotionChoice) {
  try {
    if (choice === 'system') localStorage.removeItem(MOTION_KEY);
    else localStorage.setItem(MOTION_KEY, choice);
  } catch {
    /* storage blocked: the choice simply won't persist */
  }
  window.location.reload();
}
