import React, { useState } from 'react';
import { Alert, Platform, StyleSheet, View } from 'react-native';
import { Button, Card, Chip, IconButton, Menu, Text, useTheme } from 'react-native-paper';
import { absoluteAudioUrl } from './api';
import type { Category, Entry } from './types';

export function CategoryPicker({ categories, value, onChange, label = 'Kategorie (optional)' }: {
  categories: Category[]; value: string | null; onChange: (id: string | null) => void; label?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = categories.find((item) => item.id === value);
  return (
    <Menu visible={open} onDismiss={() => setOpen(false)} anchor={
      <Button mode="outlined" icon="folder-outline" onPress={() => setOpen(true)} contentStyle={styles.control} accessibilityLabel={label}>
        {selected?.name ?? label}
      </Button>
    }>
      <Menu.Item title="Ohne Kategorie" leadingIcon="folder-off-outline" onPress={() => { onChange(null); setOpen(false); }} />
      {categories.map((category) => <Menu.Item key={category.id} title={category.name} leadingIcon="folder-outline" onPress={() => { onChange(category.id); setOpen(false); }} />)}
    </Menu>
  );
}

export function AudioPlayer({ url }: { url: string }) {
  if (Platform.OS === 'web') {
    const AudioElement = 'audio' as unknown as React.ElementType;
    return <AudioElement controls preload="metadata" src={absoluteAudioUrl(url)} style={{ width: '100%', height: 44 }} aria-label="Italienische Aussprache" />;
  }
  return <Text variant="bodyMedium">Audiowiedergabe ist in dieser MVP-Version für das Web optimiert.</Text>;
}

async function confirmDelete(message: string): Promise<boolean> {
  if (Platform.OS === 'web') return globalThis.confirm(message);
  return new Promise((resolve) => Alert.alert('Wirklich löschen?', message, [
    { text: 'Abbrechen', style: 'cancel', onPress: () => resolve(false) },
    { text: 'Löschen', style: 'destructive', onPress: () => resolve(true) },
  ]));
}

export function EntryCard({ entry, categories, busy, onRetryAudio, onDelete, onAssign }: {
  entry: Entry; categories: Category[]; busy?: boolean;
  onRetryAudio: (entry: Entry) => void; onDelete: (entry: Entry) => void; onAssign: (entry: Entry, categoryId: string | null) => void;
}) {
  const theme = useTheme();
  const [categoryOpen, setCategoryOpen] = useState(false);
  const date = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.createdAt));
  return (
    <Card mode="elevated" style={styles.card} accessible accessibilityLabel={`Deutsch: ${entry.sourceText}. Italienisch: ${entry.translatedText}`}>
      <Card.Content style={styles.cardContent}>
        <View style={styles.metaRow}>
          <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>{date}</Text>
          {entry.categoryName ? <Chip compact icon="folder-outline">{entry.categoryName}</Chip> : null}
        </View>
        <View style={styles.languageBlock}>
          <Text variant="labelLarge" style={{ color: theme.colors.primary }}>DEUTSCH</Text>
          <Text variant="titleMedium" selectable>{entry.sourceText}</Text>
        </View>
        <View style={[styles.languageBlock, { backgroundColor: theme.colors.primaryContainer }]}>
          <Text variant="labelLarge" style={{ color: theme.colors.onPrimaryContainer }}>ITALIENISCH</Text>
          <Text variant="headlineSmall" selectable style={{ color: theme.colors.onPrimaryContainer }}>{entry.translatedText}</Text>
        </View>
        {entry.audioStatus === 'ready' && entry.audioUrl ? <AudioPlayer url={entry.audioUrl} /> : (
          <View style={[styles.audioError, { backgroundColor: theme.colors.errorContainer }]}>
            <Text style={{ color: theme.colors.onErrorContainer }}>Audio konnte nicht erstellt werden.</Text>
            <Button mode="text" icon="refresh" loading={Boolean(busy)} disabled={Boolean(busy)} onPress={() => onRetryAudio(entry)}>Audio erneut versuchen</Button>
          </View>
        )}
        <View style={styles.cardActions}>
          <Menu visible={categoryOpen} onDismiss={() => setCategoryOpen(false)} anchor={
            <Button mode="text" icon="folder-edit-outline" onPress={() => setCategoryOpen(true)}>Kategorie</Button>
          }>
            <Menu.Item title="Ohne Kategorie" onPress={() => { onAssign(entry, null); setCategoryOpen(false); }} />
            {categories.map((category) => <Menu.Item key={category.id} title={category.name} onPress={() => { onAssign(entry, category.id); setCategoryOpen(false); }} />)}
          </Menu>
          <IconButton icon="delete-outline" accessibilityLabel="Eintrag löschen" disabled={Boolean(busy)} onPress={async () => { if (await confirmDelete('Dieser Satz wird dauerhaft gelöscht.')) onDelete(entry); }} />
        </View>
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  control: { minHeight: 48 },
  card: { width: '100%', borderRadius: 20 },
  cardContent: { gap: 16 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  languageBlock: { gap: 5, padding: 16, borderRadius: 14 },
  audioError: { padding: 12, borderRadius: 12, gap: 4 },
  cardActions: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
