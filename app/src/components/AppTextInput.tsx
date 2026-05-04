import { useState } from 'react';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import { TextInput, HelperText } from 'react-native-paper';

import { colors } from '../theme/colors';

type PaperTextInputProps = ComponentProps<typeof TextInput>;

type Props = Omit<PaperTextInputProps, 'mode'> & {
  mode?: PaperTextInputProps['mode'];
  errorMessage?: string;
};

export function AppTextInput({
  mode = 'outlined',
  style,
  contentStyle,
  onFocus,
  onBlur,
  errorMessage,
  error,
  ...props
}: Props) {

  // Estado para controlar a posição do cursor
  const [inputSelection, setInputSelection] = useState<{ start: number; end: number } | undefined>(undefined);

  // Estado para controlar quando há erro
  const hasError = error || !!errorMessage;

  return (
    <View style={styles.container}>
      <TextInput
        mode={mode}
        dense
        outlineColor={colors.border}
        activeOutlineColor={colors.primary}
        textColor={colors.text}
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.primary}
        cursorColor={colors.primary}
        error={hasError}
        style={[styles.input, style]}
        contentStyle={[styles.content, contentStyle]}
        textAlign="left"
        selection={inputSelection}
        onFocus={(e) => {
          // Ao focar, deixamos o React Native livre para seguir o cursor no final do texto
          setInputSelection(undefined);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          // Ao perder o foco, forçamos o scroll de volta para o caractere 0 (início do texto)
          setInputSelection({ start: 0, end: 0 });
          onBlur?.(e);
        }}
        {...props}
      />
      {/* Exibe a mensagem de erro em vermelho abaixo do input */}
      {!!errorMessage && (
        <HelperText type="error" visible={hasError} style={styles.errorText}>
          {errorMessage}
        </HelperText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  input: {
    backgroundColor: colors.surface,
  },
  content: {
    textAlign: 'left',
  },
  errorText: {
    paddingHorizontal: 0, 
    paddingTop: 4,
    paddingBottom: 0,
  }
});
