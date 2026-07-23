import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Card, Snackbar, Text, TextInput, useTheme } from 'react-native-paper';
import { api, ApiError } from '../api';
import { AudioPlayer, AudioPlaylist, CategoryPicker, EntryCard, type AudioPlaylistItem } from '../components';
import type { Category, Entry } from '../types';

export function EntriesScreen({ categories, revision, onChanged, goNew }: { categories: Category[]; revision: number; onChanged: () => void; goNew: () => void }) {
  const theme = useTheme();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const selectedCategory = categories.find((category) => category.id === categoryId);
  const playlist = entries.reduce<AudioPlaylistItem[]>((items, entry) => {
    const id = entry.batchId ?? entry.id;
    if (entry.audioStatus !== 'ready' || !entry.audioUrl || items.some((item) => item.id === id)) return items;
    items.push({
      id,
      label: entry.batchId ? `Gemeinsame Aussprache ab „${entry.translatedText}“` : entry.translatedText,
      url: entry.audioUrl,
    });
    return items;
  }, []);
  const groups = entries.reduce<Entry[][]>((all, entry) => {
    if (!entry.batchId) { all.push([entry]); return all; }
    const existing = all.find((group) => group[0]?.batchId === entry.batchId);
    if (existing) existing.push(entry);
    else all.push([entry]);
    return all;
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(true);
      api.entries(search.trim(), categoryId ?? '').then((result) => setEntries(result.entries)).catch((error) => setMessage(error instanceof ApiError ? error.message : 'Sätze konnten nicht geladen werden.')).finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [search, categoryId, revision]);

  async function retryAudio(entry: Entry) {
    setBusyId(entry.id);
    try {
      const result = await api.retryAudio(entry.id);
      setEntries((all) => all.map((item) => item.id === entry.id || (entry.batchId && item.batchId === entry.batchId) ? { ...item, audioStatus: result.entry.audioStatus, audioUrl: result.entry.audioUrl, updatedAt: result.entry.updatedAt } : item));
      setMessage('Audio wurde erstellt.');
    }
    catch (error) { setMessage(error instanceof ApiError ? error.message : 'Audio konnte nicht erstellt werden.'); }
    finally { setBusyId(null); }
  }
  async function remove(entry: Entry) {
    setBusyId(entry.id);
    try {
      await api.deleteEntry(entry.id);
      setEntries((all) => all.filter((item) => item.id !== entry.id).map((item) => entry.batchId && item.batchId === entry.batchId ? { ...item, audioStatus: 'failed', audioUrl: null } : item));
      setMessage(entry.batchId ? 'Eintrag gelöscht. Das gemeinsame Audio kann bei Bedarf neu erstellt werden.' : 'Eintrag und nicht mehr benötigtes Audio gelöscht.'); onChanged();
    }
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
      {!loading && selectedCategory && entries.length ? (
        <Card mode="outlined">
          <Card.Content style={styles.categoryPlaylist}>
            <View style={styles.categoryPlaylistHeading}>
              <Text variant="titleLarge">Kategorie „{selectedCategory.name}“ anhören</Text>
              <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                {playlist.length ? `${playlist.length} verfügbare ${playlist.length === 1 ? 'Audiospur' : 'Audiospuren'} werden nacheinander abgespielt.` : 'Für die angezeigten Sätze ist noch kein Audio verfügbar.'}
              </Text>
            </View>
            {playlist.length ? <AudioPlaylist items={playlist} /> : null}
          </Card.Content>
        </Card>
      ) : null}
      {!loading && entries.length === 0 ? (
        <View style={[styles.empty, { backgroundColor: theme.colors.surfaceVariant }]}>
          <Text variant="displaySmall">💬</Text><Text variant="headlineSmall">Noch nichts gefunden</Text>
          <Text variant="bodyLarge" style={{ textAlign: 'center', color: theme.colors.onSurfaceVariant }}>{search || categoryId ? 'Ändere die Suche oder den Filter.' : 'Erstelle deinen ersten persönlichen Satz.'}</Text>
          {!search && !categoryId ? <Button mode="contained" icon="plus" onPress={goNew}>Ersten Satz erstellen</Button> : null}
        </View>
      ) : null}
      <View style={styles.list}>{groups.map((group) => {
        const first = group[0]!;
        if (!first.batchId) return <EntryCard key={first.id} entry={first} categories={categories} busy={busyId === first.id} onRetryAudio={retryAudio} onDelete={remove} onAssign={assign} />;
        return <View key={first.batchId} style={styles.batchGroup}>
          <Card mode="outlined"><Card.Content style={styles.batchAudio}>
            <Text variant="titleMedium">Gemeinsame Aussprache · {group.length} Sätze</Text>
            {first.audioStatus === 'ready' && first.audioUrl ? <AudioPlayer url={first.audioUrl} /> : <Button mode="contained-tonal" icon="refresh" loading={group.some((item) => item.id === busyId)} disabled={Boolean(busyId)} onPress={() => retryAudio(first)}>Gemeinsames Audio neu erstellen</Button>}
          </Card.Content></Card>
          {group.map((entry) => <EntryCard key={entry.id} entry={entry} categories={categories} busy={busyId === entry.id} hideAudio onRetryAudio={retryAudio} onDelete={remove} onAssign={assign} />)}
        </View>;
      })}</View>
      <Snackbar visible={Boolean(message)} onDismiss={() => setMessage('')} duration={5000}>{message}</Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { width: '100%', maxWidth: 900, alignSelf: 'center', gap: 24, paddingBottom: 40 }, heading: { gap: 8 },
  filters: { flexDirection: 'row', gap: 12, flexWrap: 'wrap', alignItems: 'center' }, search: { flexGrow: 1, minWidth: 240 },
  list: { gap: 18 }, center: { padding: 48, alignItems: 'center', gap: 16 },
  batchGroup: { gap: 14 },
  batchAudio: { gap: 12 },
  categoryPlaylist: { gap: 14 },
  categoryPlaylistHeading: { gap: 4 },
  empty: { padding: 36, borderRadius: 24, alignItems: 'center', gap: 14 },
});
