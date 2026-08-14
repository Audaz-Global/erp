from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, white
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.lib.utils import simpleSplit
from pathlib import Path

OUT = Path(r"C:\Users\GustavoOliveira-Auda\Documents\Antigravity\Automatização Cotação\output\pdf\visao-chat-cotacoes-audaz.pdf")
OUT.parent.mkdir(parents=True, exist_ok=True)
W, H = 960, 540
NAVY = HexColor('#0D1633')
NAVY_2 = HexColor('#172244')
INK = HexColor('#182036')
MUTED = HexColor('#667085')
LINE = HexColor('#D8DEE8')
PANEL = HexColor('#F4F6FA')
ORANGE = HexColor('#F5A623')
BLUE = HexColor('#3478F6')
GREEN = HexColor('#117A65')

def text(c, x, y, value, size=16, color=INK, bold=False, font=None, leading=None, max_width=None):
    font = font or ('Helvetica-Bold' if bold else 'Helvetica')
    c.setFillColor(color); c.setFont(font, size)
    lines = simpleSplit(value, font, size, max_width) if max_width else value.split('\n')
    leading = leading or size * 1.28
    for i, line in enumerate(lines): c.drawString(x, y-i*leading, line)
    return y-len(lines)*leading

def box(c, x, y, w, h, fill=white, stroke=LINE, radius=12):
    c.setFillColor(fill); c.setStrokeColor(stroke); c.roundRect(x,y,w,h,radius,fill=1,stroke=1)

def header(c, n, eyebrow, title, subtitle=None):
    c.setFillColor(white); c.rect(0,0,W,H,fill=1,stroke=0)
    c.setFillColor(NAVY); c.rect(0,H-86,W,86,fill=1,stroke=0)
    text(c,54,H-37,'AUDAZ GLOBAL',13,white,True)
    text(c,54,H-59,eyebrow.upper(),10,HexColor('#B8C5E0'),True)
    text(c,54,H-132,title,31,INK,True,max_width=820)
    if subtitle: text(c,54,H-164,subtitle,15,MUTED,max_width=830)
    c.setStrokeColor(ORANGE); c.setLineWidth(3); c.line(54,H-181,148,H-181)
    text(c,910,24,str(n).zfill(2),10,MUTED,True)

def bullets(c, x, y, items, width=360, size=15, color=INK):
    for item in items:
        c.setFillColor(ORANGE); c.circle(x+4,y+4,3,fill=1,stroke=0)
        lines=simpleSplit(item,'Helvetica',size,width-24)
        text(c,x+20,y, '\n'.join(lines),size,color,False,max_width=width-24)
        y-=len(lines)*size*1.28+14
    return y

def footer(c, label='Proposta para validação com Daniel'):
    c.setStrokeColor(LINE); c.setLineWidth(.7); c.line(54,43,906,43)
    text(c,54,25,label,9,MUTED)

c=canvas.Canvas(str(OUT),pagesize=(W,H))
c.setTitle('Visão de evolução - Chat como motor de cotações')

# 1
c.setFillColor(NAVY); c.rect(0,0,W,H,fill=1,stroke=0)
c.setFillColor(ORANGE); c.rect(0,0,18,H,fill=1,stroke=0)
text(c,72,450,'AUDAZ GLOBAL',15,ORANGE,True)
text(c,72,367,'O chat como motor\nda operação de cotações',40,white,True,leading=48)
text(c,72,250,'Uma proposta para transformar e-mails, tarifas e regras\nem decisões operacionais acompanháveis.',18,HexColor('#C9D4EC'),max_width=610)
box(c,690,128,190,245,NAVY_2,HexColor('#30406C'),18)
text(c,718,323,'Objetivo',14,ORANGE,True)
text(c,718,276,'Menos\ndigitação.\nMais controle.',25,white,True,leading=32)
text(c,72,68,'Conversa de validação com Daniel',12,HexColor('#C9D4EC'))
c.showPage()

# 2
header(c,2,'Ponto de partida','A operação já possui dados; falta uma interface que coordene o trabalho.','Hoje a inteligência está distribuída entre e-mails, regras, telas e planilhas.')
for x,title,desc in [(54,'E-mails e anexos','Dados chegam em formatos diferentes.'),(342,'Regras e tarifas','Conhecimento existe, mas precisa ser acionado.'),(630,'Decisão humana','A equipe ainda reconcilia e cobra informações.')]:
    box(c,x,184,276,172,PANEL,LINE)
    c.setFillColor(ORANGE); c.circle(x+28,323,8,fill=1,stroke=0)
    text(c,x+22,283,title,18,INK,True)
    text(c,x+22,248,desc,14,MUTED,max_width=226)
text(c,54,126,'A oportunidade: centralizar o diálogo e deixar o sistema executar etapas previsíveis,',19,INK,True)
text(c,54,99,'escalando para a equipe apenas decisões comerciais, exceções e dados ausentes.',19,INK,True)
footer(c); c.showPage()

# 3
header(c,3,'Visão proposta','O usuário conversa; o sistema organiza, executa e explica.','O chat é a porta de entrada. As telas atuais viram ambiente de revisão e auditoria.')
steps=[('1','Entender','Lê pedido, e-mail e anexos.'),('2','Estruturar','Classifica modal, Incoterm e carga.'),('3','Aplicar','Consulta regras, tarifas e parceiros.'),('4','Validar','Aponta lacunas e riscos.'),('5','Entregar','Gera e-mail, custo e proposta.')]
start=54; gap=12; cardw=164
for i,(num,title,desc) in enumerate(steps):
    x=start+i*(cardw+gap)
    box(c,x,222,cardw,150,white,LINE,12)
    c.setFillColor(ORANGE); c.circle(x+28,339,14,fill=1,stroke=0)
    text(c,x+24,334,num,12,NAVY,True)
    text(c,x+20,294,title,18,INK,True)
    text(c,x+20,262,desc,12,MUTED,max_width=124)
    if i<len(steps)-1:
        c.setStrokeColor(BLUE); c.setLineWidth(2); c.line(x+cardw+2,297,x+cardw+gap-3,297)
footer(c); c.showPage()

# 4
header(c,4,'Agentes especializados','Cada agente tem um papel claro e deixa evidências para a equipe.','Não é uma “caixa-preta”: toda ação mostra fonte, regra e nível de confiança.')
agents=[('Leitura','Extrai dados de e-mails, PDFs, packing lists e tarifários.'),('Classificação','Identifica direção, Incoterm, modal e equipamento.'),('Regras','Aplica responsabilidades e campos obrigatórios.'),('Tarifas','Busca valores por armador, porto, vigência e equipamento.'),('Parceiros','Monta e acompanha pedidos de cotação em inglês.'),('Conferência','Compara retorno do agente com a solicitação original.')]
for i,(title,desc) in enumerate(agents):
    col=i%3; row=i//3; x=54+col*292; y=280-row*155
    box(c,x,y,264,122,PANEL,LINE,10)
    text(c,x+18,y+87,title,17,INK,True)
    text(c,x+18,y+58,desc,12,MUTED,max_width=225)
footer(c); c.showPage()

# 5
header(c,5,'Exemplo de uso','O chat conduz a cotação sem esconder decisões importantes.','A equipe entra quando precisa validar, completar ou decidir.')
box(c,54,191,510,207,PANEL,LINE,15)
text(c,78,362,'Usuário',12,BLUE,True)
text(c,78,330,'“Tenho uma importação aérea FCA de Shenzhen para Guarulhos.',16,INK,True)
text(c,78,306,'São 3 volumes e preciso de uma cotação urgente.”',16,INK,True)
box(c,396,214,432,168,white,HexColor('#C9D4EC'),15)
text(c,420,350,'Copiloto Audaz',12,GREEN,True)
text(c,420,320,'Identifiquei FCA aéreo e preparei a solicitação.',15,INK,True,max_width=360)
text(c,420,289,'Faltam valor comercial e data de pronto.',15,INK,True,max_width=360)
text(c,420,258,'Posso enviar para três agentes elegíveis?',15,INK,True,max_width=360)
text(c,54,132,'O mesmo padrão vale para retornos: “encontrei frete, mas falta validade e free time”.',18,INK,True,max_width=830)
footer(c); c.showPage()

# 6
header(c,6,'Controles que mantêm a operação segura','A automação propõe e executa o previsível; a equipe aprova o que tem impacto comercial.')
left=['Fonte exibida: e-mail, anexo, tarifário ou cadastro.','Confiança da extração e alerta para revisão.','Regras aplicadas explicadas no contexto da cotação.']
right=['Tarifa aprovada somente dentro da vigência.','Campos críticos bloqueiam proposta incompleta.','Histórico preserva decisão, exceção e responsável.']
box(c,54,198,386,184,HexColor('#F9F5E8'),HexColor('#E7D6A1'),12); text(c,78,344,'O sistema decide',18,INK,True); bullets(c,78,311,left,330,13)
box(c,520,198,386,184,HexColor('#EEF6F4'),HexColor('#B7DCD4'),12); text(c,544,344,'A equipe confirma',18,INK,True); bullets(c,544,311,right,330,13)
footer(c); c.showPage()

# 7
header(c,7,'O que muda na prática','Menos trabalho repetitivo, mais velocidade e decisões mais rastreáveis.')
items=[('Para o comercial','Acompanha a cotação pelo chat e recebe alertas claros.'),('Para operações','Reduz conferência manual entre pedido, retorno e tarifa.'),('Para gestão','Enxerga exceções, pendências e qualidade dos dados.'),('Para parceiros','Recebem pedidos completos, padronizados e em inglês.')]
for i,(title,desc) in enumerate(items):
    x=54+(i%2)*430; y=278-(i//2)*132
    c.setFillColor(ORANGE); c.circle(x+12,y+70,7,fill=1,stroke=0)
    text(c,x+32,y+79,title,18,INK,True)
    text(c,x+32,y+51,desc,14,MUTED,max_width=340)
footer(c); c.showPage()

# 8
header(c,8,'Validação solicitada ao Daniel','Antes de construir, precisamos confirmar prioridades e limites operacionais.','A proposta evolui em etapas, começando por um fluxo de cotação mais frequente.')
questions=['Qual fluxo deve ser o piloto: aéreo importação, marítimo FCL ou outro?','Quais decisões o sistema pode tomar sozinho e quais exigem aprovação?','Quais dados são obrigatórios para disparar pedido ao agente?','Como medir sucesso: prazo, completude, redução de retrabalho ou margem?']
bullets(c,72,342,questions,770,16)
box(c,72,125,768,63,NAVY,NAVY,12)
text(c,96,157,'Próximo passo sugerido: desenhar o piloto, suas regras e suas aprovações em conjunto.',17,white,True,max_width=710)
footer(c,'Proposta conceitual - conteúdo para validação operacional')
c.save()
print(OUT)
