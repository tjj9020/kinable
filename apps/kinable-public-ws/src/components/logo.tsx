import { Shield } from "lucide-react"
import { memo } from "react"

interface LogoProps {
  size?: "small" | "default" | "large";
}

// Memoize the Logo component to prevent unnecessary re-renders
export const Logo = memo(function Logo({ size = "default" }: LogoProps) {
  const sizeClasses = {
    small: "h-6 w-6",
    default: "h-8 w-8",
    large: "h-10 w-10",
  }

  return (
    <div className="flex items-center gap-2">
      <div className="bg-gradient-to-r from-teal-500 to-cyan-600 p-2 rounded-lg">
        <Shield className={`${sizeClasses[size]} text-white`} />
      </div>
      <span
        className={`font-bold ${size === "large" ? "text-2xl" : size === "small" ? "text-lg" : "text-xl"}`}
      >
        Kinable
      </span>
    </div>
  )
}) 