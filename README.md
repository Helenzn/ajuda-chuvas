# Cadastro de Ajuda às Famílias Atingidas pelas Chuvas

## Introdução

Depois de chuvas fortes, muitas famílias perdem itens básicos de casa, roupas e alimentos, e quem quer ajudar tem dificuldade em saber o que cada família precisa e onde ela está. Este projeto é uma página web simples para organizar essa ajuda: as famílias se cadastram e informam suas necessidades, e os voluntários consultam os pedidos e montam as rotas de entrega.

O sistema roda inteiramente no Google Planilhas com Google Apps Script. É gratuito, não precisa de servidor e os cadastros ficam salvos numa planilha do Google.

## Objetivo

- Permitir que qualquer família atingida se cadastre pelo celular, sem login, informando nome, telefone, endereço e CEP.
- Registrar o que cada família precisa, separado por categoria (higiene e limpeza, roupas e calçados, alimentos e água, itens de casa como colchões e cobertores), com descrição e quantidade.
- Dar aos voluntários uma área protegida por senha para acompanhar os pedidos e calcular rotas de entrega otimizadas a partir dos endereços cadastrados.

## Funcionalidades

**Página de cadastro (pública)**
- Preenchimento automático de rua e bairro a partir do CEP (ViaCEP).
- Restrição opcional por abrangência: uma cidade, um estado ou o país inteiro.
- Campo de ponto de referência para locais de difícil acesso.
- Indicação opcional de pessoas prioritárias na casa (idosos, crianças pequenas, gestantes, pessoas com deficiência ou acamadas).
- Número de protocolo ao final do cadastro.

**Área de entregas (com senha)**
- Resumo com totais por situação e por categoria.
- Lista filtrável por situação, categoria, cidade e bairro, com busca por texto. O filtro de cidade aparece automaticamente quando há cadastros de mais de uma cidade.
- Contato direto pelo WhatsApp: cada cadastro tem um link que abre a conversa com o telefone informado, sem precisar salvar o número.
- Link "Ver no mapa" para abrir a localização de cada família no Google Maps.
- Cálculo de rotas: divide as entregas selecionadas em viagens e ordena cada viagem pelo menor caminho (Google Maps).
- Link de cada viagem para abrir no Google Maps, com opção de impressão.
- Controle de situação: Pendente, Em rota, Entregue, Cancelado.
- Aviso de possível cadastro repetido (mesmo telefone).

## Estrutura

| Arquivo | Descrição |
|---|---|
| `Code.gs` | Código do servidor (Apps Script): salva cadastros, consulta CEP, localiza endereços no mapa, controla a senha e calcula rotas. |
| `Index.html` | Interface: formulário de cadastro e área de entregas. |

## Detalhes técnicos

### Arquitetura
- **Plataforma:** Google Apps Script (runtime V8) publicado como App da Web, vinculado a uma Planilha Google que funciona como banco de dados (uma linha por cadastro).
- **Comunicação:** a interface chama as funções do servidor com `google.script.run`. Não há API REST exposta nem chaves no navegador.
- **Interface:** HTML, CSS e JavaScript puros, sem frameworks nem dependências externas. Layout pensado primeiro para celular.

### Serviços externos
| Serviço | Uso | Como é acessado |
|---|---|---|
| ViaCEP | Preencher rua e bairro a partir do CEP e verificar a cidade | `UrlFetchApp`, no servidor, com cache de 6 horas (`CacheService`) |
| Google Maps Geocoding | Converter o endereço em latitude e longitude no momento do cadastro | Serviço `Maps.newGeocoder()` do Apps Script |
| Google Maps Directions | Calcular distância e tempo reais pelas ruas e otimizar a ordem das paradas | Serviço `Maps.newDirectionFinder()` do Apps Script |
| WhatsApp | Abrir conversa com a família | Link `https://wa.me/55<DDD><número>` |

Nenhum desses serviços exige chave de API: o Apps Script usa a cota da própria conta Google.

### Localização dos endereços (geocodificação)
A localização é calculada uma vez, no cadastro, e salva na planilha. Assim o cálculo de rotas fica rápido e gasta menos cota. O sistema tenta, em ordem:
1. endereço completo (rua, número, bairro, cidade, CEP);
2. rua e bairro, sem número;
3. apenas o CEP.

Se o Google retornar um ponto exato (`ROOFTOP` ou `RANGE_INTERPOLATED`) na primeira tentativa, o cadastro é marcado como localização **Exata**; caso contrário, **Aproximada**. Se nenhuma tentativa der certo, fica **Não localizado** e o cadastro não entra nas rotas.

### Cálculo de rotas
O cálculo combina um algoritmo próprio com a API do Google, em três etapas:

1. **Ordenação inicial: heurística do vizinho mais próximo.** A partir do ponto de partida, o algoritmo escolhe sempre a família mais próxima ainda não visitada, usando a distância em linha reta pela fórmula de Haversine. Isso gera uma sequência que agrupa endereços vizinhos.
2. **Divisão em viagens.** A sequência é cortada em blocos com o número de paradas por viagem definido pelo voluntário (máximo de 23, limite do Google para otimização). Como a sequência já está agrupada por proximidade, cada viagem cobre uma região.
3. **Otimização pelas ruas: Google Directions com `optimizeWaypoints`.** Cada viagem é enviada ao Google, que reordena as paradas para o menor percurso pelas ruas reais (uma versão do problema do caixeiro-viajante) e retorna distância e tempo de direção.
   - Com retorno ao ponto de partida, o destino final é o próprio ponto de partida.
   - Sem retorno, a viagem termina na parada mais distante da origem, e as demais são otimizadas.

**Plano B:** se o Google não responder (cota esgotada ou falha temporária), a viagem mantém a ordem do vizinho mais próximo, e a distância é estimada como a linha reta multiplicada por 1,35, a uma velocidade média de 25 km/h. A tela indica quando o resultado é uma estimativa.

**Limitações:** a etapa 1 é uma heurística, então a divisão em viagens é boa, mas não necessariamente a melhor possível. O tempo exibido considera só a direção, sem contar o tempo de cada parada.

### Links do Google Maps
Os links usam o formato `google.com/maps/dir/?api=1` com origem, destino e paradas intermediárias. Como o aplicativo do Google Maps no celular aceita até 10 pontos por link, viagens maiores são divididas em trechos consecutivos: cada trecho começa onde o anterior termina.

### Segurança no código
- **Senha:** lida das Propriedades do script e conferida no servidor em toda função da área de entregas. Cada tentativa errada espera cerca de 1 segundo para dificultar tentativas em sequência.
- **Validação no servidor:** todos os campos são validados e têm tamanho limitado no servidor, não só no navegador.
- **Concorrência:** gravações usam `LockService` para que dois cadastros simultâneos não recebam o mesmo protocolo.
- **Injeção de fórmulas:** textos que começam com `=`, `+`, `-` ou `@` são gravados como texto puro, para não virarem fórmulas na planilha.
- **XSS:** todo conteúdo digitado pelas famílias é escapado antes de ser exibido na área de entregas.
- **Cadastros repetidos:** um novo cadastro com o mesmo telefone de um anterior recebe um aviso na coluna de observações.

## Como publicar

É preciso uma conta Google. Leva cerca de 10 minutos.

### 1. Criar a planilha
1. Acesse [sheets.google.com](https://sheets.google.com) e crie uma planilha em branco.
2. Dê um nome, por exemplo *Cadastro Ajuda Chuvas*.

### 2. Colar o código
1. Na planilha, abra **Extensões > Apps Script**. O projeto precisa ser criado a partir da planilha para ficar vinculado a ela.
2. Substitua o conteúdo de `Código.gs` pelo conteúdo de **Code.gs**.
3. No topo do código, preencha a seção `CONFIG`:
   - `CIDADE` e `UF`: definem quem pode se cadastrar (veja a tabela abaixo).
   - `CONTATO`: telefone para dúvidas (opcional).

   | Abrangência | `CIDADE` | `UF` |
   |---|---|---|
   | Uma cidade | `'Petrópolis'` | `'RJ'` |
   | Um estado | `''` | `'RS'` |
   | Todo o país | `''` | `''` |
4. Em **Arquivos > + > HTML**, crie um arquivo chamado **Index** e cole o conteúdo de **Index.html**.
5. Salve (Ctrl+S).

### 3. Definir a senha dos voluntários
A senha não fica no código. Para defini-la:
1. Clique em **Configurações do projeto** (ícone de engrenagem, à esquerda).
2. Em **Propriedades do script**, clique em **Adicionar propriedade**.
3. Propriedade: `SENHA_ENTREGAS`. Valor: a senha escolhida. Prefira uma frase longa, de quatro ou cinco palavras.
4. Salve.

### 4. Autorizar
1. Abra o arquivo `Code.gs`, escolha a função **configurar** na barra superior e clique em **Executar**.
2. Autorize o acesso: **Revisar permissões > sua conta > Avançado > Acessar (não seguro) > Permitir**. O aviso aparece porque o script é seu e não passou por verificação do Google.

### 5. Publicar
1. Clique em **Implantar > Nova implantação**.
2. Na engrenagem, escolha **App da Web**.
3. **Executar como:** Eu. **Quem pode acessar:** Qualquer pessoa.
4. Clique em **Implantar** e copie o URL (termina em `/exec`).

Links resultantes:
- **Cadastro:** o URL copiado.
- **Área de entregas:** o mesmo URL com `?pagina=entregas` no final.

Para publicar alterações feitas no código: **Implantar > Gerenciar implantações > Editar > Versão: Nova versão > Implantar**. O link continua o mesmo.

## Uso da área de entregas

1. Entre com a senha.
2. Filtre e selecione as famílias que entrarão nas entregas.
3. Informe o ponto de partida (local das doações) e o número de paradas por viagem.
4. Clique em **Calcular rotas** e abra cada viagem no Google Maps.
5. Após a entrega, marque a viagem como **Entregue**.

Cadastros sem localização no mapa não entram na rota. Corrija o endereço na planilha ou faça a entrega separadamente.

## Segurança e privacidade

- A senha fica nas Propriedades do script, fora do código. Não a escreva em nenhum arquivo do repositório.
- Os dados das famílias ficam apenas na planilha, que é privada até ser compartilhada. Compartilhe só com quem coordena as entregas.
- Sem a senha, a página não mostra dados de nenhuma família. A verificação é feita no servidor.
- O link de cadastro é público por natureza: qualquer pessoa com ele pode enviar um cadastro. Confirme os pedidos por telefone antes das entregas quando possível.
- Os cadastros contêm dados pessoais protegidos pela LGPD. Não publique planilhas exportadas, prints ou qualquer arquivo com dados das famílias.

## Adaptação para outros contextos

O projeto nasceu para as enchentes, mas a estrutura (cadastro de necessidades, localização dos endereços e rotas de entrega) serve para outras situações em que é preciso levar ajuda a muitas famílias.

**Escala.** A abrangência é definida na configuração: o mesmo sistema atende uma cidade, um estado inteiro ou o país todo. Quando há mais de uma cidade, o formulário passa a pedir a cidade, a área de entregas ganha um filtro por cidade e o ponto de partida das rotas deve incluir a cidade. Para áreas grandes, o ideal é filtrar por cidade ou região antes de calcular as rotas.

**Outros tipos de desastre.** O texto da página é configurado em `NOME_CAMPANHA` e `EVENTO` (que completa a frase "famílias atingidas ..."). Alguns exemplos de uso:
- rompimento de barragens, como o de Mariana (MG), em 2015;
- deslizamentos de terra, vendavais e incêndios;
- secas e falta de abastecimento de água;
- campanhas de inverno ou de arrecadação para famílias em situação de vulnerabilidade.

**Outras categorias.** As quatro categorias de necessidade (higiene, roupas, alimentos e itens de casa) estão no `Index.html` e nas colunas da planilha. Elas podem ser trocadas, por exemplo, por medicamentos, materiais de construção ou ração para animais. Isso exige ajustar o formulário e a lista da área de entregas no `Index.html`, e a lista `COLUNAS` e a função `salvarCadastro` no `Code.gs`.

Para cada nova situação, o recomendado é criar uma planilha e uma implantação próprias, para manter os dados de cada ação separados.

## Limites

- Uma conta Google comum permite cerca de mil consultas de mapa por dia, suficiente para algumas centenas de cadastros diários.
- Cada viagem aceita até 23 paradas. No celular, o Google Maps abre até 10 pontos por link, por isso viagens maiores são divididas em trechos.
