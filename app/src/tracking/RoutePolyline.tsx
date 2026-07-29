import { Platform } from 'react-native';
import { Polyline } from 'react-native-maps';
import type { MapPolylineProps } from 'react-native-maps';

const isIOS = Platform.OS === 'ios';

/**
 * Traçado de rota que respeita a cor no iOS.
 *
 * No react-native-maps 1.20.x (iOS + Google Maps) o construtor nativo de
 * `AIRGoogleMapPolyline` já cria a linha com um `span` de cor nula:
 *
 *   _polyline.spans = @[[GMSStyleSpan spanWithColor:_strokeColor]];  // nil
 *
 * No GMSPolyline o `span` tem precedência sobre o `strokeColor`, e nenhuma
 * chamada posterior de `setStrokeColor:` reescreve esse span — o traçado sai
 * sem a cor pedida (no iPhone, sem aparecer). O Android não passa por isso.
 *
 * A única prop que reescreve o span pelo lado do JS é `fillColor`
 * (`setFillColor:` faz `spans = @[spanWithColor:fillColor]`), e ela é ignorada
 * no Android — por isso a repetimos com o mesmo valor do `strokeColor`.
 *
 * Ver react-native-maps#5253. Ao atualizar o pacote, verifique se o construtor
 * ainda tem essas linhas: se saírem, este wrapper vira só um `Polyline`.
 *
 * NÃO use com `lineDashPattern`: a linha tracejada monta os próprios spans e a
 * ordem em que as props chegam ao nativo não é garantida — o `fillColor` pode
 * chegar depois e apagar o tracejado. Tracejado já sai com a cor certa no iOS,
 * justamente porque reconstrói os spans; nesse caso use o `Polyline` direto.
 */
export function RoutePolyline({ strokeColor, ...rest }: MapPolylineProps) {
  return (
    <Polyline
      {...rest}
      strokeColor={strokeColor}
      fillColor={isIOS ? strokeColor : undefined}
    />
  );
}
