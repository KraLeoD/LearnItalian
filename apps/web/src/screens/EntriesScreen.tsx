import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Snackbar, Text, TextInput, useTheme } from 'react-native-paper';
import { api, ApiError } from '../api';
import { CategoryPicker, EntryCard } from '../components';
import type { Category, Entry } from '../types';

export function EntriesScreen({ categories, revision, onChanged, goNew }: { categories: Category[]; revision: number; onChanged: () => void; goNew: () => void }) {
  const theme = useTheme();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(true);
      api.entries(search.trim(), categoryId ?? '').then((result) => setEntries(result.entries)).catch((error) => setMessage(error instanceof ApiError ? error.message : 'Sätze konnten nicht geladen werden.')).finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [search, categoryId, revision]);

  async function retryAudio(entry: Entry) {
    setBusyId(entry.id);
    try { const result = await api.retryAudio(entry.id); setEntries((all) => all.map((item) => item.id === entry.id ? result.entry : item)); setMessage('Audio wurde erstellt.'); }
    catch (error) { setMessage(error instanceof ApiError ? error.message : 'Audio konnte nicht erstellt werden.'); }
    finally { setBusyId(null); }
  }
  async function remove(entry: Entry) {
    setBusyId(entry.id);
    try { await api.deleteEntry(entry.id); setEntries((all) => all.filter((item) => item.id !== entry.id)); setMessage('Eintrag gelöscht.'); onChanged(); }
    catch (error) { setMessage(error instanceof ApiError ? error.message : 'Eintrag konnte nicht gelöscht werden.'); }
    finally { setBusyId(null); }
  }
  async function assign(entry: Entry, next: string | null) {
    setBusyId(entry.id);
    try { const result = await api.assignCategory(entry.id, next); setEntries((all) => all.map((item) => item.id === entry.id ? result.entry : item)); onChanged(); }
    catch (error) { setMessage(error instanceof ApiError ? error.message : 'Kategorie konnte nicht geändert werden.'); }
    finally { setBusyId(null); }
  }

  return (
    <View style={styles.page}>
      <View style={styles.heading}><Text variant="displaySmall">Meine Sätze</Text><Text variant="bodyLarge" style={{ color: theme.colors.onSurfaceVariant }}>Deine persönliche Sammlung zum Lesen, Hören und Mitsprechen.</Text></View>
      <View style={styles.filters}>
        <TextInput mode="outlined" value={search} onChangeText={setSearch} label="Sätze durchsuchen" left={<TextInput.Icon icon="magnify" />} style={styles.search} accessibilityLabel="Gespeicherte Sätze durchsuchen" />
        <CategoryPicker categories={categories} value={categoryId} onChange={setCategoryId} label="Alle Kategorien" />
      </View>
      {loading ? <View style={styles.center} accessibilityLiveRegion="polite"><ActivityIndicator size="large" /><Text>Sätze werden geladen …</Text></View> : null}
      {!loading && entries.length === 0 ? (
        <View style={[styles.empty, { backgroundColor: theme.colors.surfaceVariant }]}>
          <Text variant="displaySmall">💬</Text><Text variant="headlineSmall">Noch nichts gefunden</Text>
          <Text variant="bodyLarge" style={{ textAlign: 'center', color: theme.colors.onSurfaceVariant }}>{search || categoryId ? 'Ändere die Suche oder den Filter.' : 'Erstelle deinen ersten persönlichen Satz.'}</Text>
          {!search && !categoryId ? <Button mode="contained" icon="plus" onPress={goNew}>Ersten Satz erstellen</Button> : null}
        </View>
      ) : null}
      <View style={styles.list}>{entries.map((entry) => <EntryCard key={entry.id} entry={entry} categories={categories} busy={busyId === entry.id} onRetryAudio={retryAudio} onDelete={remove} onAssign={assign} />)}</View>
      <Snackbar visible={Boolean(message)} onDismiss={() => setMessage('')} duration={5000}>{message}</Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { width: '100%', maxWidth: 900, alignSelf: 'center', gap: 24, paddingBottom: 40 }, heading: { gap: 8 },
  filters: { flexDirection: 'row', gap: 12, flexWrap: 'wrap', alignItems: 'center' }, search: { flexGrow: 1, minWidth: 240 },
  list: { gap: 18 }, center: { padding: 48, alignItems: 'center', gap: 16 },
  empty: { padding: 36, borderRadius: 24, alignItems: 'center', gap: 14 },
});
