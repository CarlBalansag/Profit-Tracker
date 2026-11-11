// The one summary card used across pages: label, value, optional note and icon.
const TONES = {
  default: 'text-white',
  accent: 'text-purple-400',
  green: 'text-green-400',
  amber: 'text-amber-400',
  red: 'text-red-400',
};

const StatCard = ({ label, value, sub, icon: Icon, iconColor, tone = 'default', info, compact = false, className = '', ...rest }) => (
  <div {...rest} className={`card relative min-w-0 ${compact ? 'p-3 sm:p-4' : 'p-4'} ${className}`}>
    {Icon && <Icon size={16} className={`absolute right-4 top-4 ${iconColor ? '' : TONES[tone]}`} style={iconColor ? { color: iconColor } : undefined} />}
    <span className={`${Icon ? 'pr-6 ' : info ? 'max-sm:block max-sm:pr-5 ' : ''}text-[11px] font-semibold uppercase tracking-wider text-gray-400`}>{label}</span>
    {info && <span className="max-sm:absolute max-sm:right-2 max-sm:top-3">{info}</span>}
    <p className={`${compact ? 'mt-1 sm:mt-2' : 'mt-2'} text-xl font-bold ${TONES[tone] || tone}`}>{value}</p>
    {sub && <p className={`mt-1 whitespace-pre-line text-[11px] text-gray-500 ${compact ? 'hidden sm:block' : ''}`}>{sub}</p>}
  </div>
);

export default StatCard;
