import type { ComponentProps } from 'react';
import { StyleSheet } from 'react-native';
import { TextInput } from 'react-native-paper';

import { colors } from '../theme/colors';

type PaperTextInputProps = ComponentProps<typeof TextInput>;

type Props = Omit<PaperTextInputProps, 'mode'> & {
  mode?: PaperTextInputProps['mode'];
};

export function AppTextInput({ mode = 'outlined', style, ...props }: Props) {
  return (
    <TextInput
      mode={mode}
      dense
      outlineColor={colors.border}
      activeOutlineColor={colors.primary}
      textColor={colors.text}
      placeholderTextColor={colors.textMuted}
      selectionColor={colors.primary}
      cursorColor={colors.primary}
      style={[styles.input, style]}
      {...props}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: colors.surface,
  },
});
