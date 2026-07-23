import React, { useCallback, useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, useColorScheme, useWindowDimensions, View } from 'react-native';
import { Icon, PaperProvider, Snackbar, Text, TouchableRipple, useTheme } from 'react-native-paper';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { api, ApiError } from './src/api';
import { CategoriesScreen } from './src/screens/CategoriesScreen';
import { EntriesScreen } from './src/screens/EntriesScreen';
import { InfoScreen } from './src/screens/InfoScreen';
import { NewScreen } from './src/screens/NewScreen';
import { darkTheme, lightTheme } from './src/theme';
import type { Category, VoiceOption } from './src/types';

type Route = 'new' | 'entries' | 'categories' | 'info';
const routes: Array<{ key: Route; label: string; icon: string; activeIcon: string }> = [
  { key: 'new', label: 'Neu', icon: 'plus-circle-outline', activeIcon: 'plus-circle' },
  { key: 'entries', label: 'Meine Sätze', icon: 'cards-outline', activeIcon: 'cards' },
  { key: 'categories', label: 'Kategorien', icon: 'folder-outline', activeIcon: 'folder' },
  { key: 'info', label: 'Info', icon: 'information-outline', activeIcon: 'information' },
];

function getStoredTheme(): boolean | null {
  if (Platform.OS !== 'web') return null;
  const value = globalThis.localStorage?.getItem('theme');
  return value === 'dark' ? true : value === 'light' ? false : null;
}

function getStoredVoice(): string {
  if (Platform.OS !== 'web') return 'it-IT-ElsaNeural';
  return globalThis.localStorage?.getItem('speechVoice') ?? 'it-IT-ElsaNeural';
}

export default function App() {
  const systemDark = useColorScheme() === 'dark';
  const [dark, setDark] = useState(() => getStoredTheme() ?? systemDark);
  return (
    <SafeAreaProvider>
      <PaperProvider theme={dark ? darkTheme : lightTheme}>
        <StatusBar style={dark ? 'light' : 'dark'} />
        <Application dark={dark} onToggleDark={() => setDark((current) => {
          const next = !current;
          if (Platform.OS === 'web') globalThis.localStorage?.setItem('theme', next ? 'dark' : 'light');
          return next;
        })} />
      </PaperProvider>
    </SafeAreaProvider>
  );
}

function Application({ dark, onToggleDark }: { dark: boolean; onToggleDark: () => void }) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const desktop = width >= 900;
  const [route, setRoute] = useState<Route>('new');
  const [categories, setCategories] = useState<Category[]>([]);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [voice, setVoice] = useState(getStoredVoice);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const loadCategories = useCallback(async () => {
    try { const result = await api.categories(); setCategories(result.categories); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Kategorien konnten nicht geladen werden.'); }
  }, []);
  useEffect(() => { void loadCategories(); }, [loadCategories]);
  useEffect(() => {
    api.info().then((info) => {
      setVoices(info.voices);
      setVoice((current) => info.voices.some((item) => item.id === current) ? current : info.defaultVoice);
    }).catch(() => undefined);
  }, []);
  const changeVoice = (next: string) => {
    setVoice(next);
    if (Platform.OS === 'web') globalThis.localStorage?.setItem('speechVoice', next);
  };
  const changed = () => setRevision((value) => value + 1);
  const selectedIndex = routes.findIndex((item) => item.key === route);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]} edges={['top', 'left', 'right']}>
      <View style={styles.shell}>
        {desktop ? <NavigationRail route={route} onRoute={setRoute} /> : null}
        <View style={styles.main}>
          <View style={[styles.topBar, { borderBottomColor: theme.colors.outlineVariant }]}>
            <View style={[styles.logo, { backgroundColor: theme.colors.primaryContainer }]}><Text variant="titleLarge" style={{ color: theme.colors.onPrimaryContainer }}>Parla</Text></View>
            <Text variant="titleLarge" style={{ color: theme.colors.onSurfaceVariant }}>italienisch für deinen Alltag</Text>
          </View>
          <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, !desktop && styles.contentMobile]} keyboardShouldPersistTaps="handled">
            {route === 'new' ? <NewScreen categories={categories} voices={voices} voice={voice} onVoiceChange={changeVoice} onChanged={changed} /> : null}
            {route === 'entries' ? <EntriesScreen categories={categories} revision={revision} onChanged={changed} goNew={() => setRoute('new')} /> : null}
            {route === 'categories' ? <CategoriesScreen categories={categories} reload={loadCategories} /> : null}
            {route === 'info' ? <InfoScreen dark={dark} onToggleDark={onToggleDark} /> : null}
          </ScrollView>
          {!desktop ? <NavigationBar selectedIndex={selectedIndex} onDestinationSelected={(index) => setRoute(routes[index]?.key ?? 'new')} destinations={routes.map((item) => ({ key: item.key, label: item.label, icon: item.icon, focusedIcon: item.activeIcon }))} /> : null}
        </View>
      </View>
      <Snackbar visible={Boolean(error)} onDismiss={() => setError('')} action={{ label: 'Erneut', onPress: loadCategories }}>{error}</Snackbar>
    </SafeAreaView>
  );
}

function NavigationBar({ selectedIndex, onDestinationSelected, destinations }: { selectedIndex: number; onDestinationSelected: (index: number) => void; destinations: Array<{ key: string; label: string; icon: string; focusedIcon: string }> }) {
  const theme = useTheme();
  return <View style={[styles.bottomBar, { backgroundColor: theme.colors.elevation.level2 }]}>{destinations.map((item, index) => {
    const active = selectedIndex === index;
    return <TouchableRipple key={item.key} style={styles.bottomItem} onPress={() => onDestinationSelected(index)} accessibilityRole="tab" accessibilityState={{ selected: active }}>
      <><Icon source={active ? item.focusedIcon : item.icon} size={24} color={active ? theme.colors.primary : theme.colors.onSurfaceVariant} /><Text variant="labelSmall" style={{ color: active ? theme.colors.primary : theme.colors.onSurfaceVariant }}>{item.label}</Text></>
    </TouchableRipple>;
  })}</View>;
}

function NavigationRail({ route, onRoute }: { route: Route; onRoute: (route: Route) => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.rail, { backgroundColor: theme.colors.elevation.level2, borderRightColor: theme.colors.outlineVariant }]}>
      <View style={styles.railBrand}><View style={[styles.brandMark, { backgroundColor: theme.colors.primary }]}><Text variant="headlineSmall" style={{ color: theme.colors.onPrimary }}>P</Text></View><Text variant="titleMedium">Parla</Text></View>
      <View style={styles.railItems}>{routes.map((item) => {
        const active = route === item.key;
        return <TouchableRipple key={item.key} onPress={() => onRoute(item.key)} borderless style={[styles.railItem, active && { backgroundColor: theme.colors.secondaryContainer }]} accessibilityRole="tab" accessibilityState={{ selected: active }}>
          <><Icon source={active ? item.activeIcon : item.icon} size={25} color={active ? theme.colors.onSecondaryContainer : theme.colors.onSurfaceVariant} /><Text variant="labelLarge" style={{ color: active ? theme.colors.onSecondaryContainer : theme.colors.onSurfaceVariant }}>{item.label}</Text></>
        </TouchableRipple>;
      })}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 }, shell: { flex: 1, flexDirection: 'row' }, main: { flex: 1 },
  topBar: { minHeight: 76, paddingHorizontal: 24, flexDirection: 'row', alignItems: 'center', gap: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  logo: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1 }, content: { padding: 36, minHeight: '100%' }, contentMobile: { paddingHorizontal: 16, paddingVertical: 24 },
  rail: { width: 232, borderRightWidth: StyleSheet.hairlineWidth, padding: 16 }, railBrand: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, marginBottom: 24 },
  brandMark: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, railItems: { gap: 8 },
  bottomBar: { minHeight: 72, flexDirection: "row", alignItems: "stretch" },
  bottomItem: { flex: 1, minHeight: 64, alignItems: "center", justifyContent: "center", gap: 4 },
  railItem: { minHeight: 56, borderRadius: 28, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 14 },
});
