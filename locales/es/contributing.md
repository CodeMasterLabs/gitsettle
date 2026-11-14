# Contribuir con GitSettle

1. Abre la lista de tareas y elige una incidencia que puedas resolver. Si se trata
   de una traducción, comprueba el idioma y la ruta de los archivos antes de
   reservar la recompensa.
2. Conecta una cartera de la red de pruebas de NEAR. Abre la recompensa y pulsa
   **Claim this bounty**. La cuenta que reserve el trabajo será la que reciba
   el pago.
3. Prepara los cambios en una solicitud de incorporación de cambios (pull
   request) dirigida al repositorio de la recompensa. Sigue los criterios de
   aceptación de la incidencia y pide al responsable que revise el trabajo.
4. Copia las dos líneas de verificación de la recompensa en la descripción de
   la solicitud:

   ```text
   Closes https://github.com/CodeMasterLabs/gitsettle/issues/ISSUE_NUMBER
   GitSettle: CONTRACT_ACCOUNT/BOUNTY_ID/YOUR_TESTNET_ACCOUNT
   ```

   Sustituye cada marcador por el valor que aparece en la recompensa. Escribe
   las líneas reales como texto normal en la descripción de la solicitud,
   fuera de bloques de código y citas.
5. Envía la URL de la solicitud desde la página de la recompensa **antes de la
   fecha límite**. Los cambios pueden integrarse después; una solicitud enviada
   a tiempo permanece protegida mientras espera la verificación.
6. Cuando se integren los cambios, el verificador comprobará el repositorio,
   la incidencia, el marcador de la cartera y la ruta del idioma solicitado.
   Una transferencia correcta en NEAR cambia el estado de la recompensa a
   **Settled** y acredita puntos de contribución en tu cuenta.

La recompensa permanece depositada en un contrato de NEAR. El verificador es
un servicio de confianza y quien publicó la recompensa también puede autorizar
el pago. GitSettle no evalúa de forma independiente la calidad del código ni de
la traducción. Lee el [modelo de confianza](../../README.md#trust-model-and-limitations)
antes de utilizarlo. El despliegue incluido usa tokens de prueba sin valor real.

Si el verificador no puede conectarse a GitHub, espera a la siguiente comprobación.
No envíes un segundo pago ni reveles la clave privada de tu cartera. Un fallo de
la API no implica que la contribución haya fallado, y una redirección desde la
cartera no demuestra que una transacción se haya completado correctamente.
