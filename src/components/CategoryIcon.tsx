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
  HelpCircle,
  Coffee,
  Film,
  Gift,
  Music,
  Book,
  Wrench,
  Plane,
  Dog,
  Dumbbell,
  Zap,
  GraduationCap,
  Shield,
  Tag,
  Sparkles,
  Landmark,
  Wallet,
  CreditCard,
  DollarSign,
  PiggyBank,
  Smile,
  TreePine,
  Fuel,
  Tv,
  Wifi
} from 'lucide-react';

export const AVAILABLE_CATEGORY_ICONS = [
  'ShoppingCart', 'Home', 'Car', 'Utensils', 'Coffee', 'Smartphone',
  'ShoppingBag', 'HeartPulse', 'TrendingUp', 'Briefcase', 'RotateCcw',
  'Package', 'Film', 'Gift', 'Music', 'Book', 'Wrench', 'Plane',
  'Dog', 'Dumbbell', 'Zap', 'GraduationCap', 'Shield', 'Tag',
  'Sparkles', 'Landmark', 'Wallet', 'CreditCard', 'PiggyBank', 'TreePine', 'Fuel', 'Tv', 'Wifi'
];

export const AVAILABLE_CATEGORY_COLORS = [
  '#30D158', '#0A84FF', '#FF9F0A', '#FF375F', '#BF5AF2', '#FFD60A',
  '#64D2FF', '#5E5CE6', '#32D74B', '#40C8E0', '#8E8E93', '#FF453A',
  '#F472B6', '#38BDF8', '#4ADE80', '#FBBF24', '#A78BFA', '#FB7185'
];

interface CategoryIconProps {
  name: string;
  className?: string;
}

export const CategoryIcon: React.FC<CategoryIconProps> = ({ name, className = 'w-5 h-5' }) => {
  switch (name) {
    case 'ShoppingCart': return <ShoppingCart className={className} />;
    case 'Home': return <Home className={className} />;
    case 'Car': return <Car className={className} />;
    case 'Utensils': return <Utensils className={className} />;
    case 'Coffee': return <Coffee className={className} />;
    case 'Smartphone': return <Smartphone className={className} />;
    case 'ShoppingBag': return <ShoppingBag className={className} />;
    case 'HeartPulse': return <HeartPulse className={className} />;
    case 'TrendingUp': return <TrendingUp className={className} />;
    case 'Briefcase': return <Briefcase className={className} />;
    case 'RotateCcw': return <RotateCcw className={className} />;
    case 'Package': return <Package className={className} />;
    case 'Film': return <Film className={className} />;
    case 'Gift': return <Gift className={className} />;
    case 'Music': return <Music className={className} />;
    case 'Book': return <Book className={className} />;
    case 'Wrench': return <Wrench className={className} />;
    case 'Plane': return <Plane className={className} />;
    case 'Dog': return <Dog className={className} />;
    case 'Dumbbell': return <Dumbbell className={className} />;
    case 'Zap': return <Zap className={className} />;
    case 'GraduationCap': return <GraduationCap className={className} />;
    case 'Shield': return <Shield className={className} />;
    case 'Tag': return <Tag className={className} />;
    case 'Sparkles': return <Sparkles className={className} />;
    case 'Landmark': return <Landmark className={className} />;
    case 'Wallet': return <Wallet className={className} />;
    case 'CreditCard': return <CreditCard className={className} />;
    case 'DollarSign': return <DollarSign className={className} />;
    case 'PiggyBank': return <PiggyBank className={className} />;
    case 'Smile': return <Smile className={className} />;
    case 'TreePine': return <TreePine className={className} />;
    case 'Fuel': return <Fuel className={className} />;
    case 'Tv': return <Tv className={className} />;
    case 'Wifi': return <Wifi className={className} />;
    default: return <HelpCircle className={className} />;
  }
};
