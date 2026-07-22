import { MD3DarkTheme, MD3LightTheme, type MD3Theme } from 'react-native-paper';

export const lightTheme: MD3Theme = {
  ...MD3LightTheme,
  roundness: 4,
  colors: {
    ...MD3LightTheme.colors,
    primary: '#6750A4', onPrimary: '#FFFFFF', primaryContainer: '#EADDFF', onPrimaryContainer: '#21005D',
    secondary: '#625B71', secondaryContainer: '#E8DEF8', tertiary: '#7D5260',
    background: '#FFFBFE', surface: '#FFFBFE', surfaceVariant: '#E7E0EC', outline: '#79747E',
    error: '#B3261E', elevation: { ...MD3LightTheme.colors.elevation, level1: '#F7F2FA', level2: '#F3EDF7', level3: '#EEE8F4' },
  },
};

export const darkTheme: MD3Theme = {
  ...MD3DarkTheme,
  roundness: 4,
  colors: {
    ...MD3DarkTheme.colors,
    primary: '#D0BCFF', onPrimary: '#381E72', primaryContainer: '#4F378B', onPrimaryContainer: '#EADDFF',
    background: '#1C1B1F', surface: '#1C1B1F', surfaceVariant: '#49454F', outline: '#938F99',
  },
};
