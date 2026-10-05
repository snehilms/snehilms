import styles from './Scrim.module.css';

/** Legibility ground between the canvas and the DOM. See the stylesheet. */
export function Scrim() {
  return <div className={styles.scrim} aria-hidden="true" />;
}
