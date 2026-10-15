import React from 'react';
import {
  ShoppingCart,
  Home,
  Car,
  Utensils,
  Smartphone,
  ShoppingBag,
  HeartPulse,
  TrendingUp,
  Briefcase,
  RotateCcw,
  Package,
  HelpCircle
} from 'lucide-react';

interface CategoryIconProps {
  name: string;
  className?: string;
}

export const CategoryIcon: React.FC<CategoryIconProps> = ({ name, className = 'w-5 h-5' }) => {
  switch (name) {
    case 'ShoppingCart':
      return <ShoppingCart className={className} />;
    case 'Home':
      return <Home className={className} />;
    case 'Car':
      return <Car className={className} />;
    case 'Utensils':
      return <Utensils className={className} />;
    case 'Smartphone':
      return <Smartphone className={className} />;
    case 'ShoppingBag':
      return <ShoppingBag className={className} />;
    case 'HeartPulse':
      return <HeartPulse className={className} />;
    case 'TrendingUp':
      return <TrendingUp className={className} />;
    case 'Briefcase':
      return <Briefcase className={className} />;
    case 'RotateCcw':
      return <RotateCcw className={className} />;
    case 'Package':
      return <Package className={className} />;
    default:
      return <HelpCircle className={className} />;
  }
};
