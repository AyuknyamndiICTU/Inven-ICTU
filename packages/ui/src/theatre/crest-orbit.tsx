import type { CSSProperties } from 'react';
import { cn } from '../cn';

/**
 * ICT University crest as a slowly spinning 3D coin, circled by an animated class of students (CSS 3D, no WebGL).
 * Decorative: the accessible name comes from `label`. With reduced motion (or `still`) everything stops, facing front.
 */

type Pose = 'laptop' | 'cap' | 'book' | 'wave' | 'phone';

interface StudentLook {
  skin: string;
  hair: string;
  top: string;
  trim: string;
  pose: Pose;
  long?: boolean;
}

const CLASS: StudentLook[] = [
  { skin: '#8D5524', hair: '#1B0F08', top: '#2B2390', trim: '#EBC37E', pose: 'laptop' },
  { skin: '#C68642', hair: '#2A1A10', top: '#E87D01', trim: '#05014D', pose: 'wave', long: true },
  { skin: '#5C3A21', hair: '#0E0805', top: '#05014D', trim: '#E87D01', pose: 'cap' },
  { skin: '#E0AC69', hair: '#3B2416', top: '#4B3FC4', trim: '#F7A23B', pose: 'book', long: true },
  { skin: '#3B2219', hair: '#0B0604', top: '#F7A23B', trim: '#05014D', pose: 'phone' },
  { skin: '#A0662F', hair: '#1A0F09', top: '#1E1878', trim: '#EBC37E', pose: 'laptop', long: true },
  { skin: '#6B4226', hair: '#120A06', top: '#E87D01', trim: '#2B2390', pose: 'cap' },
  { skin: '#D19A62', hair: '#2E1B0F', top: '#2B2390', trim: '#F7A23B', pose: 'wave' },
];

function Student({ look }: { look: StudentLook }) {
  const { skin, hair, top, trim, pose, long } = look;
  return (
    <svg viewBox="0 0 64 100" className="lp-crest__svg" aria-hidden>
      <ellipse cx="32" cy="97" rx="17" ry="3" fill="rgba(0,0,0,.35)" />
      {/* legs */}
      <rect x="23" y="70" width="7" height="25" rx="3.5" fill="#1a1740" />
      <rect x="34" y="70" width="7" height="25" rx="3.5" fill="#1a1740" />
      {/* body */}
      <path d="M16 46c0-8 7-13 16-13s16 5 16 13v26H16z" fill={top} />
      <path d="M26 34l6 8 6-8" fill="none" stroke={trim} strokeWidth="2.4" strokeLinejoin="round" />
      <rect x="16" y="66" width="32" height="5" fill={trim} opacity=".9" />
      {/* arms */}
      {pose === 'wave' ? (
        <g className="lp-crest__wave">
          <path d="M46 44c6-4 9-12 10-20" stroke={top} strokeWidth="7" strokeLinecap="round" fill="none" />
          <circle cx="56.5" cy="22" r="4" fill={skin} />
        </g>
      ) : (
        <path d="M46 46c4 6 4 14 1 20" stroke={top} strokeWidth="7" strokeLinecap="round" fill="none" />
      )}
      <path d="M18 46c-4 6-4 14-1 20" stroke={top} strokeWidth="7" strokeLinecap="round" fill="none" />
      {/* head */}
      {long && <path d="M17 22c0-12 7-18 15-18s15 6 15 18v14H17z" fill={hair} />}
      <circle cx="32" cy="21" r="12" fill={skin} />
      <path d="M20 19c1-8 6-12 12-12s11 4 12 12c-4-3-8-5-12-5s-8 2-12 5z" fill={hair} />
      <circle cx="27.5" cy="22" r="1.4" fill="#120a06" />
      <circle cx="36.5" cy="22" r="1.4" fill="#120a06" />
      <path d="M28 27c2.5 2 5.5 2 8 0" stroke="#120a06" strokeWidth="1.4" strokeLinecap="round" fill="none" />
      {/* props */}
      {pose === 'cap' && (
        <g>
          <path d="M14 11l18-7 18 7-18 7z" fill="#05014D" />
          <rect x="24" y="12" width="16" height="5" rx="1" fill="#05014D" />
          <path d="M48 11v9" stroke="#EBC37E" strokeWidth="1.6" />
          <circle cx="48" cy="21" r="1.8" fill="#EBC37E" />
        </g>
      )}
      {pose === 'laptop' && (
        <g>
          <rect x="17" y="50" width="30" height="19" rx="2" fill="#cfd3dc" />
          <rect x="19" y="52" width="26" height="15" rx="1" className="lp-crest__screen" />
          <rect x="13" y="68" width="38" height="3.5" rx="1.5" fill="#9aa0ae" />
        </g>
      )}
      {pose === 'book' && (
        <g>
          <rect x="19" y="51" width="26" height="18" rx="2" fill="#E87D01" />
          <rect x="31" y="51" width="2" height="18" fill="#05014D" />
          <path d="M22 56h6M22 60h6M36 56h6M36 60h6" stroke="#fff6e6" strokeWidth="1.2" />
        </g>
      )}
      {pose === 'phone' && (
        <g>
          <rect x="38" y="48" width="11" height="19" rx="2.5" fill="#0b0833" />
          <rect x="39.5" y="50" width="8" height="14" rx="1.2" className="lp-crest__screen" />
        </g>
      )}
    </svg>
  );
}

export interface CrestOrbitProps {
  /** URL of the crest image (transparent PNG). */
  src: string;
  /** Accessible description, e.g. "ICT University". */
  label: string;
  /** Crest width in px; the scene is about 2.2× wider. */
  size?: number;
  /** Number of students in the orbiting class (0 hides it). */
  students?: number;
  /** Stop all motion (reduced-motion or kiosk "minimal" level). */
  still?: boolean;
  className?: string;
}

const LAYERS = 9;

export function CrestOrbit({ src, label, size = 260, students = 8, still, className }: CrestOrbitProps) {
  const class_ = CLASS.slice(0, Math.max(0, Math.min(students, CLASS.length)));
  const vars = { '--crest': `${size}px`, '--crest-src': `url("${src}")` } as CSSProperties;
  return (
    <div className={cn('lp-crest', still && 'is-still', className)} style={vars} role="img" aria-label={label}>
      <div className="lp-crest__halo" aria-hidden />
      <div className="lp-crest__sparks" aria-hidden>
        {Array.from({ length: 14 }, (_, i) => (
          <span key={i} style={{ '--i': i } as CSSProperties} />
        ))}
      </div>
      <div className="lp-crest__stage" aria-hidden>
        <div className="lp-crest__ring lp-crest__ring--a">
          <span className="lp-crest__track">
            <i />
          </span>
        </div>
        <div className="lp-crest__ring lp-crest__ring--b">
          <span className="lp-crest__track">
            <i />
          </span>
        </div>
        <div className="lp-crest__float">
          <div className="lp-crest__coin">
            <img className="lp-crest__face lp-crest__face--back" src={src} alt="" draggable={false} />
            {Array.from({ length: LAYERS }, (_, i) => (
              <img
                key={i}
                className="lp-crest__face lp-crest__edge"
                src={src}
                alt=""
                draggable={false}
                style={{ '--z': (i + 1) / (LAYERS + 1) } as CSSProperties}
              />
            ))}
            <img className="lp-crest__face lp-crest__face--front" src={src} alt="" draggable={false} />
            <span className="lp-crest__sheen" />
          </div>
        </div>
        {class_.length > 0 && (
          <div className="lp-crest__class">
            {class_.map((look, i) => {
              const a = (360 / class_.length) * i;
              return (
                <div key={i} className="lp-crest__seat" style={{ '--a': `${a}deg` } as CSSProperties}>
                  <div className="lp-crest__unturn">
                    <div className="lp-crest__bill">
                      <div className="lp-crest__bob" style={{ '--d': i } as CSSProperties}>
                        <Student look={look} />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="lp-crest__floor" aria-hidden />
    </div>
  );
}
