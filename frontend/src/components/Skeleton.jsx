export default function Skeleton({ className = '', width, height, rounded = 'rounded-md' }) {
  const style = {};
  if (width) style.width = width;
  if (height) style.height = height;
  return <div className={`skeleton ${rounded} ${className}`} style={style} />;
}
