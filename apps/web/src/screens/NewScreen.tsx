import React, { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Card, HelperText, Snackbar, Text, TextInput, useTheme } from 'react-native-paper';
import { api, ApiError } from '../api';
import { CategoryPicker, EntryCard } from '../components';
import type { Category, Entry } from '../types';

export function NewScreen({ categories, onChanged }: { categories: Category[]; onChanged: () => void }) {
  const theme = useTheme();
  const [text, setText] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [phase, setPhase] = useState<'idle' | 'translation' | 'audio'>('idle');
  const [message, setMessage] = useState('');
  const [busyEntry, setBusyEntry] = useState(false);
  const submitting = useRef(false);
  const trimmed = text.trim();

  async function generate() {
    if (!trimmed || submitting.current) return;
    submitting.current = true;
    setEntry(null); setMessage(''); setPhase('translation');
    const timer = setTimeout(() => setPhase('audio'), 900);
    try {
      const result = await api.generate(trimmed, categoryId);
      setEntry(result.entry);
      setText('');
      setPhase('idle');
      setMessage(result.entry.audioStatus === 'ready' ? 'Eintrag gespeichert.' : 'Übersetzung gespeichert. Audio konnte nicht erstellt werden.');
      onChanged();
    } catch (error) {
      setPhase('idle');
      setMessage(error instanceof ApiError ? error.message : 'Etwas ist schiefgegangen.');
    } finally {
      clearTimeout(timer); submitting.current = false;
    }
  }

  async function retryAudio(current: Entry) {
    setBusyEntry(true);
    try { const result = await api.retryAudio(current.id); setEntry(result.entry); setMessage('Audio wurde erstellt.'); onChanged(); }
    catch (error) { setMessage(error instanceof ApiError ? error.message : 'Audio konnte nicht erstellt werden.'); }
    finally { setBusyEntry(false); }
  }

  async function deleteEntry(current: Entry) {
    setBusyEntry(true);
    try { await api.deleteEntry(current.id); setEntry(null); setMessage('Eintrag gelöscht.'); onChanged(); }
    catch (error) { setMessage(error instanceof ApiError ? error.message : 'Eintrag konnte nicht gelöscht werden.'); }
    finally { setBusyEntry(false); }
  }

  async function assign(current: Entry, nextCategory: string | null) {
    setBusyEntry(true);
    try { const result = await api.assignCategory(current.id, nextCategory); setEntry(result.entry); onChanged(); }
    catch (error) { setMessage(error instanceof ApiError ? error.message : 'Kategorie konnte nicht geändert werden.'); }
    finally { setBusyEntry(false); }
  }

  return (
    <View style={styles.page}>
      <View style={styles.heading}>
        <Text variant="displaySmall">Was möchtest du sagen?</Text>
        <Text variant="bodyLarge" style={{ color: theme.colors.onSurfaceVariant }}>Schreibe einen Satz aus deinem Alltag. Wir übersetzen ihn und sprechen ihn für dich vor.</Text>
      </View>
      <Card mode="elevated" style={styles.formCard}>
        <Card.Content style={styles.form}>
          <TextInput
            mode="outlined" label="Deutscher Text" placeholder="Zum Beispiel: Wo ist der nächste Bahnhof?"
            value={text} onChangeText={setText} multiline numberOfLines={5} maxLength={2000}
            disabled={phase !== 'idle'} autoFocus accessibilityLabel="Deutschen Text eingeben"
            style={styles.input}
          />
          <View style={styles.counter}><HelperText type={trimmed.length > 1800 ? 'error' : 'info'} visible>{text.length} / 2000 Zeichen</HelperText></View>
          <View style={styles.selectors}>
            <Button mode="outlined" icon="translate" disabled contentStyle={styles.largeControl}>Italienisch</Button>
            <CategoryPicker categories={categories} value={categoryId} onChange={setCategoryId} />
          </View>
          <Button mode="contained" icon="auto-awesome" onPress={generate} disabled={!trimmed || phase !== 'idle'} loading={phase !== 'idle'} contentStyle={styles.primaryAction}>
            Übersetzen und Audio erstellen
          </Button>
          {phase !== 'idle' ? (
            <View accessibilityLiveRegion="polite" style={[styles.progress, { backgroundColor: theme.colors.secondaryContainer }]}>
              <ActivityIndicator size="small" />
              <Text variant="bodyLarge">{phase === 'translation' ? 'Text wird übersetzt …' : 'Audio wird erstellt …'}</Text>
            </View>
          ) : null}
        </Card.Content>
      </Card>
      {entry ? <View style={styles.result}><Text variant="titleLarge">Dein neuer Satz</Text><EntryCard entry={entry} categories={categories} busy={busyEntry} onRetryAudio={retryAudio} onDelete={deleteEntry} onAssign={assign} /></View> : null}
      <Snackbar visible={Boolean(message)} onDismiss={() => setMessage('')} duration={5000} action={{ label: 'OK', onPress: () => setMessage('') }}>{message}</Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { width: '100%', maxWidth: 820, alignSelf: 'center', gap: 28, paddingBottom: 40 },
  heading: { gap: 8 }, formCard: { borderRadius: 24 }, form: { gap: 16, paddingVertical: 12 },
  input: { minHeight: 148, textAlignVertical: 'top' }, counter: { alignItems: 'flex-end', marginTop: -14 },
  selectors: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, largeControl: { minHeight: 48 },
  primaryAction: { minHeight: 56 }, progress: { flexDirection: 'row', gap: 12, alignItems: 'center', padding: 16, borderRadius: 14 },
  result: { gap: 12 },
});
