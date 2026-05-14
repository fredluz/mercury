import type React from "react";
import icon from "../../assets/icon.png";

interface MercuryMarkProps {
  size?: number;
  alt?: string;
  decorative?: boolean;
  className?: string;
}

function MercuryMark({
  size = 32,
  alt = "Mercury",
  decorative = false,
  className,
}: MercuryMarkProps): React.JSX.Element {
  return (
    <img
      src={icon}
      width={size}
      height={size}
      className={className ? `mercury-mark ${className}` : "mercury-mark"}
      alt={decorative ? "" : alt}
      aria-hidden={decorative || undefined}
    />
  );
}

export default MercuryMark;
