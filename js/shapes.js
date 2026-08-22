/**
 * Shape definitions for Photo Wall
 *
 * Built-in shapes (china map, heart, portrait) use SVG path data.
 * Dynamic shapes (text/word/number, custom image) store a maskCanvas
 * directly — generateMask() draws it without expensive SVG path tracing.
 * A low-res thumbnail path is generated for the sidebar preview icon.
 */
'use strict';

    /* ------------------------------------------------------------------ *
     *  Heart path — classic parametric heart equation
     * ------------------------------------------------------------------ */
    function generateHeartPath() {
        var steps = 300;
        var raw = [];
        var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

        for (var i = 0; i <= steps; i++) {
            var t = (i / steps) * Math.PI * 2;
            var x = 16 * Math.pow(Math.sin(t), 3);
            var y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
            raw.push({ x: x, y: y });
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }

        var rangeX = maxX - minX;
        var rangeY = maxY - minY;
        var targetW = 1000;
        var targetH = Math.round((rangeY / rangeX) * targetW);

        var d = '';
        for (var j = 0; j < raw.length; j++) {
            var px = ((raw[j].x - minX) / rangeX) * targetW;
            var py = ((raw[j].y - minY) / rangeY) * targetH;
            d += (j === 0 ? 'M' : 'L') + px.toFixed(1) + ',' + py.toFixed(1);
            if (j < raw.length - 1) d += ' ';
        }
        return { d: d + ' Z', width: targetW, height: targetH };
    }

    var heartData = generateHeartPath();

    /* ------------------------------------------------------------------ *
     *  Shape registry
     *  Shape = {
     *    name, viewBox:{width,height},
     *    paths:[...]      — SVG paths (for built-in shapes & preview icons)
     *    maskCanvas?      — HTMLCanvasElement (for dynamic shapes, used by generateMask)
     *    dynamic?:bool
     *  }
     * ------------------------------------------------------------------ */
    var Shapes = {
        china: {
            name: '中国地图',
            viewBox: { width: 1000, height: 708.9 },
            paths: [
                'M597.6,699.2 L583.5,708.9 L570.2,702.7 L569.7,685.4 L577.7,676.2 L595.5,670.6 L604.9,671.1 L608.5,678.8 L601.4,687.6 L597.6,699.2 Z',
                'M879.9,74.4 L908.3,80.8 L927.6,95.1 L934.2,114 L958.9,114 L973.1,106.1 L1000,100.1 L991.4,118.2 L985.1,125.6 L979.5,147.6 L968.6,167.2 L948.8,163.6 L934.8,170.7 L939.1,187.9 L936.7,211.7 L928.4,212.2 L928.5,222.4 L918,210.6 L911.5,221.8 L886.3,230.5 L888.9,241.1 L874.8,240.4 L867,234.1 L855.8,248.3 L837.9,259.1 L824.6,272 L801.8,277.9 L789.8,287.3 L772.3,292.7 L780.9,283.4 L777.5,275.6 L790.4,262.1 L781.8,251.5 L767.6,258.6 L749.2,272.6 L739.2,285.6 L723.2,286.6 L714.9,296 L723.4,309.5 L736.8,312.8 L737.3,321.9 L750.2,327.7 L768.5,313.4 L783,321.2 L793.5,321.7 L796.2,332.3 L773.1,337.9 L765.5,348.7 L749.6,358.8 L741.2,372.9 L758.8,384 L765.2,403.7 L775.1,422.1 L786.2,437.6 L785.9,452.5 L775.7,458 L779.6,468.7 L789.2,475 L786.7,491.4 L782.5,507.3 L773.4,509.1 L761.5,530.9 L748.3,557.2 L733.2,581.2 L710.8,599.8 L688.1,616.7 L669.7,619 L659.8,627.9 L654.1,621.4 L644.9,631.4 L622.1,641.5 L604.9,644.6 L599.3,665.8 L590.3,667 L586,652.4 L589.9,644.6 L568,638.2 L560.3,641.4 L543.9,636.2 L536.1,628.1 L538.7,616.5 L523.8,612.8 L515.9,605.3 L502.1,616 L486.2,618.3 L473.2,618.2 L464.5,623.1 L456,626 L458.5,649 L449.8,648.5 L448.3,643.8 L447.8,635.5 L435.9,641.3 L428.8,637.6 L416.7,630.1 L421.5,613.4 L411.1,609.5 L407.2,591 L390,594.3 L392,570.4 L407.4,553.7 L408.1,537.1 L407.6,521.7 L400.5,516.9 L395,505.1 L385.5,506.6 L367.9,503.6 L373.4,495.1 L365.8,482.6 L354.2,491.1 L340.5,486.1 L321.7,498.9 L306.9,513.9 L293.7,516.4 L286.6,511 L278,510.5 L266.3,505.9 L257.5,511 L246.8,525.9 L245.4,510.1 L235.4,514.3 L216.4,512.3 L198,507.7 L184.8,498.9 L172.1,494.9 L166.6,485.3 L157.5,482.4 L141,469.3 L128,463.1 L121.2,467.9 L98.5,453.9 L82.5,441.1 L78,419 L89.7,421.7 L90.2,411.4 L83.7,401.1 L85.4,384.7 L67.8,361.2 L41,353 L36.2,337.6 L24.2,328.2 L21.3,322.4 L18.8,311 L19.4,303.2 L9.5,298.6 L4.1,300.6 L0,282 L4.6,277.4 L2.4,272.7 L18,263.2 L29.2,259.3 L46.5,262 L52.6,249.1 L73.5,246.7 L79.4,238.8 L105,227.9 L107.3,223.3 L106,211.9 L117.2,206.6 L102.5,171.7 L134.8,163.7 L143.2,159.2 L154.9,123.2 L187.3,129.8 L196.3,120.7 L197.1,100.6 L210.6,98.7 L223.1,85.3 L229.4,83.7 L233.7,97.7 L247.4,108.4 L270.7,115.9 L281.9,132.1 L275.6,155.6 L281.5,164.3 L300.9,167.7 L322.8,170.5 L342.5,183.1 L352.6,185.3 L360,203.8 L369.6,215.8 L387.5,215.3 L421.2,219.8 L442.9,217 L459,220 L483.1,232.2 L502.8,232.2 L510,238.5 L529,227.7 L555.3,220.7 L579.8,219.9 L598.8,212.9 L610.5,202.1 L621.9,195.3 L619.3,188.7 L614.1,181 L622.6,168 L631.8,169.8 L648.5,173.9 L664.8,163.2 L689.6,155.4 L701.6,142.1 L713.1,136.4 L736.7,133.8 L749.6,136 L751.4,128.9 L736.6,114.8 L723.5,108.4 L711,115.8 L694.9,112.7 L685.7,115.2 L681.5,107 L693,86.9 L700.9,71.8 L720.5,79.4 L743.5,66.7 L743.3,57.8 L758,36.5 L767.1,30 L766.9,18.9 L758,14.2 L771.4,4.2 L791.7,0.5 L813.3,0 L837.7,6 L852,13.4 L862.1,33.7 L868.2,42.3 L873.9,54.7 L879.9,74.4 Z'
            ]
        },
        heart: {
            name: '爱心',
            viewBox: { width: heartData.width, height: heartData.height },
            paths: [heartData.d]
        },
        portrait: {
            name: '人像',
            viewBox: { width: 1000, height: 1000 },
            paths: [
                'M500,50 C620,50 690,140 690,255 C690,325 655,375 620,405 L620,435 C685,445 760,475 820,545 C885,620 935,745 965,895 L975,1000 L25,1000 L35,895 C65,745 115,620 180,545 C240,475 315,445 380,435 L380,405 C345,375 310,325 310,255 C310,140 380,50 500,50 Z'
            ]
        },
        circle: {
            name: '圆形',
            viewBox: { width: 1000, height: 1000 },
            paths: ['M500,35 A465,465 0 1,1 499.9,35 Z']
        },
        star: {
            name: '五角星',
            viewBox: { width: 1000, height: 960 },
            paths: ['M500,25 L612,350 L955,357 L684,568 L783,900 L500,708 L217,900 L316,568 L45,357 L388,350 Z']
        },
        moon: {
            name: '月亮',
            viewBox: { width: 1000, height: 1000 },
            paths: ['M710,55 C365,155 340,825 710,945 C350,985 65,785 65,500 C65,215 350,15 710,55 Z']
        },
        flower: {
            name: '花朵',
            viewBox: { width: 1000, height: 1000 },
            paths: [
                'M500,420 C350,350 335,145 500,45 C665,145 650,350 500,420 Z',
                'M580,500 C650,350 855,335 955,500 C855,665 650,650 580,500 Z',
                'M500,580 C650,650 665,855 500,955 C335,855 350,650 500,580 Z',
                'M420,500 C350,650 145,665 45,500 C145,335 350,350 420,500 Z',
                'M500,360 A140,140 0 1,1 499.9,360 Z'
            ]
        },
        butterfly: {
            name: '蝴蝶',
            viewBox: { width: 1000, height: 850 },
            paths: [
                'M455,390 C350,65 65,20 45,230 C30,385 205,450 350,485 C160,535 115,735 285,805 C410,855 455,665 475,525 Z',
                'M545,390 C650,65 935,20 955,230 C970,385 795,450 650,485 C840,535 885,735 715,805 C590,855 545,665 525,525 Z',
                'M470,330 C470,250 530,250 530,330 L535,690 C535,770 465,770 465,690 Z',
                'M485,275 C440,190 400,150 360,125 M515,275 C560,190 600,150 640,125'
            ]
        },
        tree: {
            name: '大树',
            viewBox: { width: 1000, height: 1000 },
            paths: [
                'M430,930 L455,655 C365,705 275,690 235,610 C120,610 65,530 110,430 C55,330 125,235 235,240 C260,115 390,65 500,145 C610,65 740,115 765,240 C875,235 945,330 890,430 C935,530 880,610 765,610 C725,690 635,705 545,655 L570,930 Z'
            ]
        },
        house: {
            name: '房子',
            viewBox: { width: 1000, height: 900 },
            paths: [
                'M70,430 L500,40 L930,430 L850,520 L800,475 L800,860 L200,860 L200,475 L150,520 Z'
            ]
        },
        paw: {
            name: '脚印',
            viewBox: { width: 1000, height: 1000 },
            paths: [
                'M500,440 C650,440 805,610 800,770 C795,920 650,965 500,865 C350,965 205,920 200,770 C195,610 350,440 500,440 Z',
                'M145,315 C145,205 215,135 300,175 C385,215 370,365 295,420 C215,475 145,425 145,315 Z',
                'M355,185 C355,70 435,20 500,95 C565,20 645,70 645,185 C645,300 570,360 500,305 C430,360 355,300 355,185 Z',
                'M700,175 C785,135 855,205 855,315 C855,425 785,475 705,420 C630,365 615,215 700,175 Z'
            ]
        },
        roundedSquare: {
            name: '圆角方形',
            viewBox: { width: 1000, height: 1000 },
            paths: ['M170,45 H830 C900,45 955,100 955,170 V830 C955,900 900,955 830,955 H170 C100,955 45,900 45,830 V170 C45,100 100,45 170,45 Z']
        },
        oval: {
            name: '椭圆',
            viewBox: { width: 1000, height: 760 },
            paths: ['M500,35 C765,35 965,175 965,380 C965,585 765,725 500,725 C235,725 35,585 35,380 C35,175 235,35 500,35 Z']
        },
        diamond: {
            name: '菱形',
            viewBox: { width: 1000, height: 1000 },
            paths: ['M500,25 L975,500 L500,975 L25,500 Z']
        },
        hexagon: {
            name: '六边形',
            viewBox: { width: 1000, height: 900 },
            paths: ['M250,30 H750 L980,450 L750,870 H250 L20,450 Z']
        },
        cloud: {
            name: '云朵',
            viewBox: { width: 1000, height: 700 },
            paths: ['M215,650 C95,650 20,570 35,465 C48,370 125,315 215,325 C245,185 365,85 505,115 C600,135 670,200 695,290 C815,255 930,330 955,440 C980,555 890,650 770,650 Z']
        },
        doubleHeart: {
            name: '双爱心',
            viewBox: { width: 1000, height: 850 },
            paths: [
                'M535,760 C430,680 145,500 145,270 C145,95 365,35 500,205 C635,35 855,95 855,270 C855,500 570,680 535,760 Z',
                'M240,800 C160,740 20,625 20,485 C20,365 165,315 255,420 C305,360 365,345 425,365 C385,550 285,675 240,800 Z'
            ]
        },
        camera: {
            name: '相机',
            viewBox: { width: 1000, height: 760 },
            paths: [
                'M85,190 H260 L330,75 H670 L740,190 H915 C955,190 980,220 980,260 V675 C980,715 950,740 910,740 H90 C50,740 20,710 20,670 V260 C20,220 45,190 85,190 Z',
                'M500,275 A185,185 0 1,1 499.9,275 Z'
            ]
        },
        gift: {
            name: '礼物',
            viewBox: { width: 1000, height: 900 },
            paths: [
                'M70,345 H930 V520 H70 Z M125,540 H875 V875 H125 Z',
                'M435,310 C280,300 185,220 220,125 C255,30 425,95 500,245 C575,95 745,30 780,125 C815,220 720,300 565,310 Z',
                'M440,345 H560 V875 H440 Z'
            ]
        },
        cake: {
            name: '生日蛋糕',
            viewBox: { width: 1000, height: 940 },
            paths: [
                'M455,35 H545 V185 H455 Z M500,5 C550,65 550,120 500,145 C450,120 450,65 500,5 Z',
                'M205,245 H795 C850,245 885,285 885,335 V480 C835,535 765,530 715,480 C650,545 570,545 500,480 C430,545 350,545 285,480 C235,530 165,535 115,480 V335 C115,285 150,245 205,245 Z',
                'M115,505 C175,555 235,555 285,520 C350,570 430,570 500,520 C570,570 650,570 715,520 C765,555 825,555 885,505 V875 H115 Z'
            ]
        },
        crown: {
            name: '皇冠',
            viewBox: { width: 1000, height: 760 },
            paths: ['M85,165 L300,345 L500,55 L700,345 L915,165 L825,650 H175 Z M175,685 H825 V745 H175 Z']
        },
        graduation: {
            name: '毕业帽',
            viewBox: { width: 1000, height: 760 },
            paths: [
                'M35,270 L500,50 L965,270 L500,490 Z',
                'M210,390 L500,530 L790,390 V600 C700,745 300,745 210,600 Z',
                'M900,300 H930 V585 H900 Z M915,565 C970,565 980,650 930,710 H870 C840,650 855,565 915,565 Z'
            ]
        },
        airplane: {
            name: '飞机',
            viewBox: { width: 1000, height: 900 },
            paths: ['M470,25 C520,10 555,55 555,115 V325 L925,535 V640 L555,515 V730 L705,825 V890 L500,825 L295,890 V825 L445,730 V515 L75,640 V535 L445,325 V115 C445,65 455,35 470,25 Z']
        },
        music: {
            name: '音符',
            viewBox: { width: 1000, height: 1000 },
            paths: [
                'M420,110 L905,20 V650 C905,775 805,875 675,850 C555,825 535,695 630,625 C680,585 745,580 810,600 V210 L515,265 V760 C515,885 415,985 285,960 C165,935 145,805 240,735 C290,695 355,690 420,710 Z'
            ]
        },
        balloon: {
            name: '气球',
            viewBox: { width: 1000, height: 1000 },
            paths: [
                'M500,25 C745,25 900,205 865,430 C835,620 690,745 540,790 L600,875 H400 L460,790 C310,745 165,620 135,430 C100,205 255,25 500,25 Z',
                'M470,875 H530 C535,920 570,950 610,975 H390 C430,950 465,920 470,875 Z'
            ]
        },
        cat: {
            name: '猫咪',
            viewBox: { width: 1000, height: 1000 },
            paths: [
                'M205,315 L145,45 L365,180 C450,145 550,145 635,180 L855,45 L795,315 C875,405 910,530 875,660 C825,850 670,950 500,950 C330,950 175,850 125,660 C90,530 125,405 205,315 Z'
            ]
        },
        dog: {
            name: '狗狗',
            viewBox: { width: 1000, height: 1000 },
            paths: [
                'M285,245 C350,175 430,145 500,145 C570,145 650,175 715,245 C795,175 915,205 925,330 C935,465 850,555 795,570 C815,760 690,920 500,940 C310,920 185,760 205,570 C150,555 65,465 75,330 C85,205 205,175 285,245 Z'
            ]
        },
        rabbit: {
            name: '兔子',
            viewBox: { width: 1000, height: 1000 },
            paths: [
                'M365,330 C285,205 300,25 390,30 C470,35 485,205 475,300 C490,295 510,295 525,300 C515,205 530,35 610,30 C700,25 715,205 635,330 C765,390 835,515 805,675 C775,840 650,940 500,940 C350,940 225,840 195,675 C165,515 235,390 365,330 Z'
            ]
        },
        fish: {
            name: '小鱼',
            viewBox: { width: 1000, height: 720 },
            paths: [
                'M70,360 L250,155 L285,275 C430,120 725,125 915,360 C725,595 430,600 285,445 L250,565 Z'
            ]
        },
        mountain: {
            name: '山峰',
            viewBox: { width: 1000, height: 760 },
            paths: [
                'M25,720 L305,250 L415,405 L590,45 L975,720 Z'
            ]
        },
        book: {
            name: '书本',
            viewBox: { width: 1000, height: 760 },
            paths: [
                'M45,95 C230,55 385,95 475,180 V700 C365,620 220,595 45,635 Z',
                'M525,180 C615,95 770,55 955,95 V635 C780,595 635,620 525,700 Z',
                'M480,170 H520 V710 H480 Z'
            ]
        },
        trophy: {
            name: '奖杯',
            viewBox: { width: 1000, height: 1000 },
            paths: [
                'M250,70 H750 V225 H905 C900,455 785,565 665,575 C630,650 585,695 555,710 V825 H735 V940 H265 V825 H445 V710 C415,695 370,650 335,575 C215,565 100,455 95,225 H250 Z',
                'M95,275 H250 V475 C175,450 120,385 95,275 Z M750,275 H905 C880,385 825,450 750,475 Z'
            ]
        },
        snowflake: {
            name: '雪花',
            viewBox: { width: 1000, height: 1000 },
            paths: [
                'M450,25 H550 V350 L805,165 L865,245 L610,430 L930,330 L965,425 L655,525 L930,625 L895,720 L610,620 L865,805 L805,885 L550,700 V975 H450 V700 L195,885 L135,805 L390,620 L105,720 L70,625 L345,525 L35,425 L70,330 L390,430 L135,245 L195,165 L450,350 Z'
            ]
        },
        clover: {
            name: '四叶草',
            viewBox: { width: 1000, height: 1000 },
            paths: [
                'M500,480 C355,420 255,325 275,210 C295,90 455,65 500,220 C545,65 705,90 725,210 C745,325 645,420 500,480 Z',
                'M480,500 C420,355 325,255 210,275 C90,295 65,455 220,500 C65,545 90,705 210,725 C325,745 420,645 480,500 Z',
                'M520,500 C580,355 675,255 790,275 C910,295 935,455 780,500 C935,545 910,705 790,725 C675,745 580,645 520,500 Z',
                'M500,520 C355,580 255,675 275,790 C295,910 455,935 500,780 C545,935 705,910 725,790 C745,675 645,580 500,520 Z'
            ]
        },
        planet: {
            name: '星球',
            viewBox: { width: 1000, height: 820 },
            paths: [
                'M500,85 C690,85 845,235 845,420 C845,605 690,755 500,755 C310,755 155,605 155,420 C155,235 310,85 500,85 Z',
                'M40,485 C125,285 370,145 655,125 C830,115 950,160 970,245 C995,350 850,465 640,555 C385,665 105,675 35,565 C20,540 20,515 40,485 Z'
            ]
        },
        stroller: {
            name: '婴儿车',
            viewBox: { width: 1000, height: 880 },
            paths: [
                'M140,105 H255 L315,250 H895 C885,520 705,690 410,690 C275,690 205,560 245,440 L140,105 Z',
                'M505,250 C510,115 620,35 755,45 C845,50 920,125 930,250 Z',
                'M335,690 A90,90 0 1,1 334.9,690 Z M745,690 A90,90 0 1,1 744.9,690 Z'
            ]
        },
        leaf: {
            name: '树叶',
            viewBox: { width: 1000, height: 1000 },
            paths: [
                'M105,885 C95,535 255,165 885,65 C915,650 655,915 220,915 L105,975 Z'
            ]
        },
        bell: {
            name: '铃铛',
            viewBox: { width: 1000, height: 1000 },
            paths: [
                'M435,85 C435,20 565,20 565,85 C725,120 805,270 805,475 C805,655 875,735 925,790 H75 C125,735 195,655 195,475 C195,270 275,120 435,85 Z',
                'M370,825 H630 C625,925 565,970 500,970 C435,970 375,925 370,825 Z'
            ]
        }
    };

    /** Get list of shape keys. */
    Shapes.keys = function () {
        return Object.keys(Shapes).filter(function (k) {
            return typeof Shapes[k] === 'object' && Shapes[k].paths;
        });
    };

    /** Register a dynamic shape. */
    Shapes.register = function (key, shape) {
        Shapes[key] = shape;
    };

    /** Remove a dynamic shape. */
    Shapes.remove = function (key) {
        delete Shapes[key];
    };

    /* ================================================================== *
     *  ShapeFactory — generate shapes from text or custom images
     *
     *  Strategy: render to canvas → store maskCanvas directly (fast),
     *  + trace a TINY thumbnail for the preview icon.
     * ================================================================== */
    var ShapeFactory = {};

    /**
     * Generate a shape from text/word/number.
     * @returns {Promise<shape>}
     */
    ShapeFactory.fromText = function (text) {
        return new Promise(function (resolve, reject) {
            if (!text || !text.trim()) {
                reject(new Error('empty text'));
                return;
            }
            text = text.trim().slice(0, 12);

            setTimeout(function () {
                var fontSize = 250;
                var font = 'bold ' + fontSize + 'px Arial, Helvetica, sans-serif';

                var mCanvas = document.createElement('canvas');
                var mctx = mCanvas.getContext('2d');
                mctx.font = font;
                var metrics = mctx.measureText(text);
                var textW = metrics.width;
                var textH = fontSize * 1.2;

                var pad = 20;
                var canvasW = Math.ceil(textW + pad * 2);
                var canvasH = Math.ceil(textH + pad * 2);

                // Render the mask canvas (white = inside)
                var canvas = document.createElement('canvas');
                canvas.width = canvasW;
                canvas.height = canvasH;
                var ctx = canvas.getContext('2d');
                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, canvasW, canvasH);
                ctx.fillStyle = '#fff';
                ctx.font = font;
                ctx.textBaseline = 'middle';
                ctx.textAlign = 'center';
                ctx.fillText(text, canvasW / 2, canvasH / 2);

                // Generate a tiny thumbnail path for preview icon (~80px wide)
                var thumbW = 80;
                var thumbH = Math.round(thumbW * canvasH / canvasW);
                var thumbCanvas = document.createElement('canvas');
                thumbCanvas.width = thumbW;
                thumbCanvas.height = thumbH;
                var tctx = thumbCanvas.getContext('2d');
                tctx.drawImage(canvas, 0, 0, thumbW, thumbH);
                var thumbData = tctx.getImageData(0, 0, thumbW, thumbH);
                var thumbPath = ShapeFactory._traceMask(thumbData);

                // Scale viewBox to ~1000 wide for consistency with built-in shapes
                var viewScale = 1000 / canvasW;

                resolve({
                    name: '"' + text + '"',
                    viewBox: {
                        width: Math.round(canvasW * viewScale),
                        height: Math.round(canvasH * viewScale)
                    },
                    paths: [thumbPath || 'M0,0 L1,0 L1,1 L0,1 Z'],
                    thumbnailViewBox: { width: thumbW, height: thumbH },
                    maskCanvas: canvas,
                    maskCanvasW: canvasW,
                    maskCanvasH: canvasH,
                    dynamic: true
                });
            }, 0);
        });
    };

    /**
     * Generate a shape from a custom image silhouette.
     * @returns {Promise<shape>}
     */
    ShapeFactory.createImageMask = function (img, options, maxDim) {
        options = options || {};
        maxDim = maxDim || 400;
        var threshold = Number(options.threshold === undefined ? 42 : options.threshold);
        var mode = options.mode || 'auto';
        var smooth = Math.max(0, Math.min(3, Number(options.smooth) || 0));
        var denoise = Math.max(0, Math.min(4, Number(options.denoise) || 0));
        var crop = options.crop || { x: 0, y: 0, width: 1, height: 1 };
        var cropX = Math.max(0, Math.min(0.97, Number(crop.x) || 0));
        var cropY = Math.max(0, Math.min(0.97, Number(crop.y) || 0));
        var cropW = Math.max(0.03, Math.min(1 - cropX, Number(crop.width) || 1));
        var cropH = Math.max(0.03, Math.min(1 - cropY, Number(crop.height) || 1));
        var sx = Math.round(cropX * img.naturalWidth), sy = Math.round(cropY * img.naturalHeight);
        var sw = Math.max(1, Math.round(cropW * img.naturalWidth));
        var sh = Math.max(1, Math.round(cropH * img.naturalHeight));
        var scale = Math.min(maxDim / sw, maxDim / sh, 1);
        var w = Math.max(1, Math.ceil(sw * scale));
        var h = Math.max(1, Math.ceil(sh * scale));
        var source = document.createElement('canvas');
        source.width = w; source.height = h;
        var sourceCtx = source.getContext('2d', { willReadFrequently: true });
        sourceCtx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
        var originalScale = Math.min(maxDim / img.naturalWidth, maxDim / img.naturalHeight, 1);
        var originalCanvas = document.createElement('canvas');
        originalCanvas.width = Math.max(1, Math.ceil(img.naturalWidth * originalScale));
        originalCanvas.height = Math.max(1, Math.ceil(img.naturalHeight * originalScale));
        originalCanvas.getContext('2d').drawImage(img, 0, 0, originalCanvas.width, originalCanvas.height);
        var imageData = sourceCtx.getImageData(0, 0, w, h);
        var data = imageData.data, total = w * h;
        var transparentCount = 0;

        for (var by = 0; by < h; by++) {
            for (var bx = 0; bx < w; bx++) {
                var bi = (by * w + bx) * 4;
                if (data[bi + 3] < 245) transparentCount++;
            }
        }
        var useAlpha = mode !== 'threshold' && transparentCount > total * 0.01;
        var mask = new Uint8Array(total), detectedCount = 0;

        if (mode === 'portrait-detail') {
            mask = ShapeFactory._extractPortraitDetailMask(data, w, h, threshold, denoise);
        } else if (!useAlpha && mode === 'portrait') {
            mask = ShapeFactory._extractPortraitMask(data, w, h, threshold, denoise);
        } else {
            var palette = ShapeFactory._sampleBackgroundPalette(data, w, h);
            for (var i = 0; i < total; i++) {
                var p = i * 4, r = data[p], g = data[p + 1], b = data[p + 2], a = data[p + 3];
                var brightness = (r + g + b) / 3;
                var colourDistance = ShapeFactory._nearestPaletteDistance(r, g, b, palette);
                var inside;
                if (useAlpha) inside = a > threshold;
                else if (mode === 'threshold') inside = brightness < threshold;
                else inside = a > 40 && colourDistance > threshold;
                mask[i] = inside ? 1 : 0;
            }
        }

        for (var mi = 0; mi < total; mi++) {
            if (options.invert) mask[mi] = !mask[mi] && data[mi * 4 + 3] > 15 ? 1 : 0;
            if (mask[mi]) detectedCount++;
        }

        if (detectedCount < total * 0.001 && mode !== 'portrait-detail') {
            for (var fallback = 0; fallback < total; fallback++) mask[fallback] = data[fallback * 4 + 3] > 40 ? 1 : 0;
        }
        for (var noisePass = 0; noisePass < Math.ceil(denoise / 2); noisePass++) {
            mask = ShapeFactory._despeckleMask(mask, w, h);
        }
        if (denoise > 0 && options.keepLargest === false) {
            var minimumArea = Math.max(2, Math.round(total * denoise * denoise * 0.000035));
            mask = ShapeFactory._removeSmallComponents(mask, w, h, minimumArea);
        }
        if (mode === 'portrait' && !options.invert) {
            // A light closing pass repairs tiny breaks without the detail loss
            // caused by the old opening pass (hair and fingers were eroded).
            var bridgeRadius = Math.max(1, Math.round(Math.min(w, h) * (0.0025 + denoise * 0.0007)));
            mask = ShapeFactory._closeMask(mask, w, h, bridgeRadius);
        }
        if (options.keepLargest !== false) mask = ShapeFactory._keepLargestComponent(mask, w, h);
        if (mode === 'portrait' && !options.invert) {
            mask = ShapeFactory._fillMaskHoles(mask, w, h);
        }
        for (var pass = 0; pass < smooth; pass++) mask = ShapeFactory._smoothMask(mask, w, h);
        if (mode === 'portrait' && !options.invert) mask = ShapeFactory._fillMaskHoles(mask, w, h);

        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        var ctx = canvas.getContext('2d');
        var output = ctx.createImageData(w, h);
        for (var m = 0; m < total; m++) {
            var value = mask[m] ? 255 : 0, oi = m * 4;
            output.data[oi] = value; output.data[oi + 1] = value; output.data[oi + 2] = value; output.data[oi + 3] = 255;
        }
        ctx.putImageData(output, 0, 0);
        if (options.strokes && options.strokes.length) {
            mask = ShapeFactory._paintMaskStrokes(ctx, mask, w, h, options.strokes);
        }
        var finalCount = 0;
        for (var countIndex = 0; countIndex < mask.length; countIndex++) finalCount += mask[countIndex];
        var stats = ShapeFactory._measureMask(mask, w, h);
        return {
            canvas: canvas,
            sourceCanvas: source,
            originalCanvas: originalCanvas,
            width: w,
            height: h,
            mask: mask,
            coverage: finalCount / Math.max(1, total),
            stats: stats
        };
    };

    ShapeFactory._colourDistance = function (r1, g1, b1, r2, g2, b2) {
        return Math.sqrt(
            (r1 - r2) * (r1 - r2) +
            (g1 - g2) * (g1 - g2) +
            (b1 - b2) * (b1 - b2)
        ) / Math.sqrt(3);
    };

    /**
     * Sample several small corner/edge patches instead of averaging the whole
     * border. A portrait often touches the bottom edge, so a full-border mean
     * is easily contaminated by clothes or hair.
     */
    ShapeFactory._sampleBackgroundPalette = function (data, w, h) {
        var patch = Math.max(3, Math.round(Math.min(w, h) * 0.055));
        var points = [
            [0, 0], [w - patch, 0], [0, h - patch], [w - patch, h - patch],
            [Math.round(w * 0.2), 0], [Math.round(w * 0.8) - patch, 0],
            [0, Math.round(h * 0.28)], [w - patch, Math.round(h * 0.28)]
        ];
        return points.map(function (point) {
            var rs = [], gs = [], bs = [];
            var x0 = Math.max(0, Math.min(w - patch, point[0]));
            var y0 = Math.max(0, Math.min(h - patch, point[1]));
            for (var y = y0; y < y0 + patch; y++) {
                for (var x = x0; x < x0 + patch; x++) {
                    var p = (y * w + x) * 4;
                    if (data[p + 3] < 32) continue;
                    rs.push(data[p]); gs.push(data[p + 1]); bs.push(data[p + 2]);
                }
            }
            rs.sort(function (a, b) { return a - b; });
            gs.sort(function (a, b) { return a - b; });
            bs.sort(function (a, b) { return a - b; });
            var middle = Math.floor(rs.length / 2);
            return { r: rs[middle] || 0, g: gs[middle] || 0, b: bs[middle] || 0 };
        });
    };

    ShapeFactory._nearestPaletteDistance = function (r, g, b, palette) {
        var best = Infinity;
        for (var i = 0; i < palette.length; i++) {
            var colour = palette[i];
            var distance = ShapeFactory._colourDistance(r, g, b, colour.r, colour.g, colour.b);
            if (distance < best) best = distance;
        }
        return best;
    };

    /** Convert to perceptual-ish YCbCr channels and apply a small bilateral
     * prefilter. It suppresses JPEG grain and wood texture without averaging
     * colours across a face/background boundary. */
    ShapeFactory._buildPortraitChannels = function (data, w, h, denoise) {
        var total = w * h;
        var rawY = new Float32Array(total), rawCb = new Float32Array(total), rawCr = new Float32Array(total);
        for (var i = 0; i < total; i++) {
            var p = i * 4, r = data[p], g = data[p + 1], b = data[p + 2];
            rawY[i] = 0.299 * r + 0.587 * g + 0.114 * b;
            rawCb[i] = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
            rawCr[i] = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
        }
        if (!denoise) return { y: rawY, cb: rawCb, cr: rawCr };

        var radius = denoise >= 3 ? 2 : 1;
        var rangeLimit = 16 + denoise * 5;
        var outY = new Float32Array(total), outCb = new Float32Array(total), outCr = new Float32Array(total);
        for (var py = 0; py < h; py++) {
            for (var px = 0; px < w; px++) {
                var index = py * w + px;
                var sumY = rawY[index] * 2, sumCb = rawCb[index] * 2, sumCr = rawCr[index] * 2, weight = 2;
                for (var oy = -radius; oy <= radius; oy++) {
                    var ny = py + oy;
                    if (ny < 0 || ny >= h) continue;
                    for (var ox = -radius; ox <= radius; ox++) {
                        var nx = px + ox;
                        if ((ox === 0 && oy === 0) || nx < 0 || nx >= w) continue;
                        var neighbour = ny * w + nx;
                        var colourDelta = Math.abs(rawY[index] - rawY[neighbour]) * 0.55 +
                            (Math.abs(rawCb[index] - rawCb[neighbour]) + Math.abs(rawCr[index] - rawCr[neighbour])) * 0.9;
                        if (colourDelta > rangeLimit) continue;
                        sumY += rawY[neighbour]; sumCb += rawCb[neighbour]; sumCr += rawCr[neighbour]; weight++;
                    }
                }
                outY[index] = sumY / weight;
                outCb[index] = sumCb / weight;
                outCr[index] = sumCr / weight;
            }
        }
        return { y: outY, cb: outCb, cr: outCr };
    };

    /** Build several robust background models, then discard edge patches that
     * are not supported by another patch (usually clothes touching a corner). */
    ShapeFactory._samplePortraitBackground = function (channels, w, h) {
        var patch = Math.max(3, Math.round(Math.min(w, h) * 0.045));
        var points = [
            [0, 0], [w - patch, 0], [0, h - patch], [w - patch, h - patch],
            [Math.round(w * 0.22), 0], [Math.round(w * 0.5) - Math.floor(patch / 2), 0],
            [Math.round(w * 0.78) - patch, 0], [0, Math.round(h * 0.22)],
            [w - patch, Math.round(h * 0.22)], [0, Math.round(h * 0.52)],
            [w - patch, Math.round(h * 0.52)]
        ];
        var models = points.map(function (point) {
            var ys = [], cbs = [], crs = [];
            var x0 = Math.max(0, Math.min(w - patch, point[0]));
            var y0 = Math.max(0, Math.min(h - patch, point[1]));
            for (var y = y0; y < Math.min(h, y0 + patch); y++) {
                for (var x = x0; x < Math.min(w, x0 + patch); x++) {
                    var index = y * w + x;
                    ys.push(channels.y[index]); cbs.push(channels.cb[index]); crs.push(channels.cr[index]);
                }
            }
            ys.sort(function (a, b) { return a - b; });
            cbs.sort(function (a, b) { return a - b; });
            crs.sort(function (a, b) { return a - b; });
            var middle = Math.floor(ys.length / 2);
            return { y: ys[middle] || 0, cb: cbs[middle] || 128, cr: crs[middle] || 128 };
        });
        var supportCounts = models.map(function (model, index) {
            var support = 0;
            for (var i = 0; i < models.length; i++) {
                if (i === index) continue;
                var other = models[i];
                var dy = Math.abs(model.y - other.y);
                var dc = Math.hypot(model.cb - other.cb, model.cr - other.cr);
                if (dy * 0.45 + dc * 1.4 < 26) support++;
            }
            return support;
        });
        var maxSupport = Math.max.apply(Math, supportCounts);
        var supported = models.filter(function (model, index) {
            return supportCounts[index] >= Math.max(1, maxSupport - 2);
        });
        return supported.length >= 2 ? supported : models;
    };

    /**
     * Edge-aware portrait silhouette extraction. A pixel is background only
     * when it resembles a robust edge model and is reachable from the image
     * border. Chroma is weighted above brightness so shadows and wall seams are
     * removed while beige skin remains protected by the strong-edge barrier.
     */
    ShapeFactory._extractPortraitMask = function (data, w, h, threshold, denoise) {
        var total = w * h;
        var channels = ShapeFactory._buildPortraitChannels(data, w, h, denoise);
        var models = ShapeFactory._samplePortraitBackground(channels, w, h);
        var candidate = new Uint8Array(total), outside = new Uint8Array(total), edge = new Float32Array(total);
        var queue = new Int32Array(total), head = 0, tail = 0;
        var localLimit = Math.max(13, threshold * 0.55);
        var edgeLimit = Math.max(22, threshold * 0.78);

        for (var y = 0; y < h; y++) {
            for (var x = 0; x < w; x++) {
                var index = y * w + x;
                var best = Infinity;
                for (var modelIndex = 0; modelIndex < models.length; modelIndex++) {
                    var model = models[modelIndex];
                    var dy = Math.abs(channels.y[index] - model.y);
                    var dc = Math.hypot(channels.cb[index] - model.cb, channels.cr[index] - model.cr);
                    var score = Math.hypot(dy * 0.58, dc * 1.55);
                    if (score < best) best = score;
                }
                candidate[index] = data[index * 4 + 3] < 20 || best <= threshold ? 1 : 0;

                var left = y * w + Math.max(0, x - 1), right = y * w + Math.min(w - 1, x + 1);
                var top = Math.max(0, y - 1) * w + x, bottom = Math.min(h - 1, y + 1) * w + x;
                var horizontal = Math.abs(channels.y[left] - channels.y[right]) * 0.55 +
                    Math.hypot(channels.cb[left] - channels.cb[right], channels.cr[left] - channels.cr[right]) * 1.25;
                var vertical = Math.abs(channels.y[top] - channels.y[bottom]) * 0.55 +
                    Math.hypot(channels.cb[top] - channels.cb[bottom], channels.cr[top] - channels.cr[bottom]) * 1.25;
                edge[index] = Math.max(horizontal, vertical);
            }
        }

        function enqueue(index) {
            if (index < 0 || index >= total || outside[index] || !candidate[index]) return;
            outside[index] = 1; queue[tail++] = index;
        }
        for (var sx = 0; sx < w; sx++) { enqueue(sx); enqueue((h - 1) * w + sx); }
        for (var sy = 1; sy < h - 1; sy++) { enqueue(sy * w); enqueue(sy * w + w - 1); }

        function visit(current, next) {
            if (outside[next] || !candidate[next]) return;
            var dy = Math.abs(channels.y[current] - channels.y[next]);
            var dc = Math.hypot(channels.cb[current] - channels.cb[next], channels.cr[current] - channels.cr[next]);
            if (dy * 0.55 + dc * 1.25 > localLimit || edge[next] > edgeLimit) return;
            outside[next] = 1; queue[tail++] = next;
        }
        while (head < tail) {
            var current = queue[head++], cx = current % w;
            if (cx > 0) visit(current, current - 1);
            if (cx < w - 1) visit(current, current + 1);
            if (current >= w) visit(current, current - w);
            if (current < total - w) visit(current, current + w);
        }

        var mask = new Uint8Array(total);
        for (var m = 0; m < total; m++) mask[m] = !outside[m] && data[m * 4 + 3] > 15 ? 1 : 0;
        return mask;
    };

    /**
     * Build a multi-component portrait mask from dark tones and local facial
     * contrast, constrained by the foreground silhouette. Unlike the normal
     * portrait mode this intentionally keeps holes and disconnected features
     * such as hair, eyebrows, eyes, nose shadows and lips.
     */
    ShapeFactory._extractPortraitDetailMask = function (data, w, h, threshold, denoise) {
        var total = w * h;
        var channels = ShapeFactory._buildPortraitChannels(data, w, h, denoise);
        var silhouette = ShapeFactory._extractPortraitMask(data, w, h, 46, denoise);
        var bridgeRadius = Math.max(1, Math.round(Math.min(w, h) * 0.0025));
        silhouette = ShapeFactory._closeMask(silhouette, w, h, bridgeRadius);
        silhouette = ShapeFactory._fillMaskHoles(silhouette, w, h);

        var stride = w + 1;
        var integral = new Float64Array((w + 1) * (h + 1));
        for (var y = 0; y < h; y++) {
            var rowSum = 0;
            for (var x = 0; x < w; x++) {
                rowSum += channels.y[y * w + x];
                integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + rowSum;
            }
        }

        var radius = Math.max(4, Math.round(Math.min(w, h) * 0.035));
        var darkLimit = Math.max(36, Math.min(220, Number(threshold) || 132));
        var contrastLimit = Math.max(7, 15 - (darkLimit - 110) * 0.045);
        var mask = new Uint8Array(total);
        for (var py = 0; py < h; py++) {
            var y1 = Math.max(0, py - radius), y2 = Math.min(h, py + radius + 1);
            for (var px = 0; px < w; px++) {
                var index = py * w + px;
                if (!silhouette[index] || data[index * 4 + 3] <= 15) continue;
                var x1 = Math.max(0, px - radius), x2 = Math.min(w, px + radius + 1);
                var sum = integral[y2 * stride + x2] - integral[y1 * stride + x2] -
                    integral[y2 * stride + x1] + integral[y1 * stride + x1];
                var localMean = sum / Math.max(1, (x2 - x1) * (y2 - y1));
                var luminance = channels.y[index];
                if (luminance <= darkLimit || localMean - luminance >= contrastLimit) mask[index] = 1;
            }
        }

        if (denoise > 1) mask = ShapeFactory._closeMask(mask, w, h, 1);
        return mask;
    };

    ShapeFactory._fillMaskHoles = function (mask, w, h) {
        var outside = new Uint8Array(mask.length), queue = new Int32Array(mask.length);
        var head = 0, tail = 0;
        function enqueue(index) {
            if (index < 0 || index >= mask.length || mask[index] || outside[index]) return;
            outside[index] = 1; queue[tail++] = index;
        }
        for (var x = 0; x < w; x++) { enqueue(x); enqueue((h - 1) * w + x); }
        for (var y = 1; y < h - 1; y++) { enqueue(y * w); enqueue(y * w + w - 1); }
        while (head < tail) {
            var current = queue[head++], cx = current % w;
            if (cx > 0) enqueue(current - 1);
            if (cx < w - 1) enqueue(current + 1);
            if (current >= w) enqueue(current - w);
            if (current < mask.length - w) enqueue(current + w);
        }
        var result = new Uint8Array(mask.length);
        for (var i = 0; i < mask.length; i++) result[i] = mask[i] || !outside[i] ? 1 : 0;
        return result;
    };

    /** Close tiny gaps between face, neck and clothing before component filtering. */
    ShapeFactory._closeMask = function (mask, w, h, radius) {
        var dilated = new Uint8Array(mask.length);
        var result = new Uint8Array(mask.length);
        for (var y = 0; y < h; y++) {
            for (var x = 0; x < w; x++) {
                var found = false;
                for (var oy = -radius; oy <= radius && !found; oy++) {
                    var ny = y + oy;
                    if (ny < 0 || ny >= h) continue;
                    for (var ox = -radius; ox <= radius; ox++) {
                        var nx = x + ox;
                        if (nx >= 0 && nx < w && mask[ny * w + nx]) { found = true; break; }
                    }
                }
                dilated[y * w + x] = found ? 1 : 0;
            }
        }
        for (var ey = 0; ey < h; ey++) {
            for (var ex = 0; ex < w; ex++) {
                var filled = true;
                for (var eoy = -radius; eoy <= radius && filled; eoy++) {
                    var eny = ey + eoy;
                    if (eny < 0 || eny >= h) continue;
                    for (var eox = -radius; eox <= radius; eox++) {
                        var enx = ex + eox;
                        if (enx < 0 || enx >= w) continue;
                        if (!dilated[eny * w + enx]) { filled = false; break; }
                    }
                }
                result[ey * w + ex] = filled ? 1 : 0;
            }
        }
        return result;
    };

    /** Remove isolated hairline artefacts such as wall seams and image noise. */
    ShapeFactory._openMask = function (mask, w, h, radius) {
        var eroded = new Uint8Array(mask.length);
        var result = new Uint8Array(mask.length);
        for (var y = 0; y < h; y++) {
            for (var x = 0; x < w; x++) {
                var filled = true;
                for (var oy = -radius; oy <= radius && filled; oy++) {
                    var ny = y + oy;
                    if (ny < 0 || ny >= h) { filled = false; break; }
                    for (var ox = -radius; ox <= radius; ox++) {
                        var nx = x + ox;
                        if (nx < 0 || nx >= w || !mask[ny * w + nx]) { filled = false; break; }
                    }
                }
                eroded[y * w + x] = filled ? 1 : 0;
            }
        }
        for (var dy = 0; dy < h; dy++) {
            for (var dx = 0; dx < w; dx++) {
                var found = false;
                for (var doy = -radius; doy <= radius && !found; doy++) {
                    var dny = dy + doy;
                    if (dny < 0 || dny >= h) continue;
                    for (var dox = -radius; dox <= radius; dox++) {
                        var dnx = dx + dox;
                        if (dnx >= 0 && dnx < w && eroded[dny * w + dnx]) { found = true; break; }
                    }
                }
                result[dy * w + dx] = found ? 1 : 0;
            }
        }
        return result;
    };

    /**
     * A photo-wall shape needs an outer silhouette, not facial features or gaps
     * between folded arms. Fill bounded gaps across every meaningful scanline.
     */
    ShapeFactory._solidifySilhouette = function (mask, w, h) {
        var result = new Uint8Array(mask);
        var minimumSpan = Math.max(3, Math.round(w * 0.025));
        for (var y = 0; y < h; y++) {
            var left = w, right = -1, count = 0;
            for (var x = 0; x < w; x++) {
                if (!mask[y * w + x]) continue;
                if (x < left) left = x;
                right = x;
                count++;
            }
            if (right - left + 1 < minimumSpan || count < 2) continue;
            for (var fillX = left; fillX <= right; fillX++) result[y * w + fillX] = 1;
        }
        return result;
    };

    ShapeFactory._keepLargestComponent = function (mask, w, h) {
        var visited = new Uint8Array(mask.length), queue = new Int32Array(mask.length);
        var best = [], directions = [-1, 1, -w, w, -w - 1, -w + 1, w - 1, w + 1];
        for (var start = 0; start < mask.length; start++) {
            if (!mask[start] || visited[start]) continue;
            var head = 0, tail = 0, component = [];
            queue[tail++] = start; visited[start] = 1;
            while (head < tail) {
                var current = queue[head++]; component.push(current);
                var x = current % w;
                for (var d = 0; d < directions.length; d++) {
                    if (((d === 0 || d === 4 || d === 6) && x === 0) ||
                        ((d === 1 || d === 5 || d === 7) && x === w - 1)) continue;
                    var next = current + directions[d];
                    if (next >= 0 && next < mask.length && mask[next] && !visited[next]) {
                        visited[next] = 1; queue[tail++] = next;
                    }
                }
            }
            if (component.length > best.length) best = component;
        }
        var result = new Uint8Array(mask.length);
        for (var i = 0; i < best.length; i++) result[best[i]] = 1;
        return result;
    };

    /** Remove only truly small foreground islands. Unlike morphological
     * opening this keeps thin but connected details such as hair and fingers. */
    ShapeFactory._removeSmallComponents = function (mask, w, h, minimumArea) {
        var visited = new Uint8Array(mask.length), queue = new Int32Array(mask.length);
        var result = new Uint8Array(mask.length);
        var directions = [-1, 1, -w, w, -w - 1, -w + 1, w - 1, w + 1];
        for (var start = 0; start < mask.length; start++) {
            if (!mask[start] || visited[start]) continue;
            var head = 0, tail = 0, component = [];
            queue[tail++] = start; visited[start] = 1;
            while (head < tail) {
                var current = queue[head++], x = current % w;
                component.push(current);
                for (var d = 0; d < directions.length; d++) {
                    if (((d === 0 || d === 4 || d === 6) && x === 0) ||
                        ((d === 1 || d === 5 || d === 7) && x === w - 1)) continue;
                    var next = current + directions[d];
                    if (next >= 0 && next < mask.length && mask[next] && !visited[next]) {
                        visited[next] = 1; queue[tail++] = next;
                    }
                }
            }
            if (component.length < minimumArea) continue;
            for (var c = 0; c < component.length; c++) result[component[c]] = 1;
        }
        return result;
    };

    /** Conservative impulse filter: remove isolated foreground pixels and fill
     * isolated pinholes, but leave ordinary contour pixels unchanged. */
    ShapeFactory._despeckleMask = function (mask, w, h) {
        var result = new Uint8Array(mask);
        for (var y = 1; y < h - 1; y++) {
            for (var x = 1; x < w - 1; x++) {
                var index = y * w + x, neighbours = 0;
                for (var oy = -1; oy <= 1; oy++) {
                    for (var ox = -1; ox <= 1; ox++) {
                        if (ox || oy) neighbours += mask[(y + oy) * w + x + ox];
                    }
                }
                if (mask[index] && neighbours <= 1) result[index] = 0;
                else if (!mask[index] && neighbours >= 7) result[index] = 1;
            }
        }
        return result;
    };

    ShapeFactory._smoothMask = function (mask, w, h) {
        var result = new Uint8Array(mask.length);
        for (var y = 0; y < h; y++) {
            for (var x = 0; x < w; x++) {
                var neighbours = 0, samples = 0;
                for (var oy = -1; oy <= 1; oy++) {
                    for (var ox = -1; ox <= 1; ox++) {
                        var nx = x + ox, ny = y + oy;
                        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                            samples++; neighbours += mask[ny * w + nx];
                        }
                    }
                }
                result[y * w + x] = neighbours >= Math.ceil(samples / 2) ? 1 : 0;
            }
        }
        return result;
    };

    ShapeFactory._paintMaskStrokes = function (ctx, mask, w, h, strokes) {
        ctx.save();
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        strokes.forEach(function (stroke) {
            if (!stroke.points || !stroke.points.length) return;
            ctx.strokeStyle = stroke.mode === 'erase' ? '#000' : '#fff';
            ctx.fillStyle = ctx.strokeStyle;
            ctx.lineWidth = Math.max(2, stroke.size * Math.min(w, h));
            ctx.beginPath();
            var first = stroke.points[0];
            ctx.moveTo(first.x * w, first.y * h);
            for (var i = 1; i < stroke.points.length; i++) {
                ctx.lineTo(stroke.points[i].x * w, stroke.points[i].y * h);
            }
            if (stroke.points.length === 1) {
                ctx.arc(first.x * w, first.y * h, ctx.lineWidth / 2, 0, Math.PI * 2);
                ctx.fill();
            } else {
                ctx.stroke();
            }
        });
        ctx.restore();
        var painted = ctx.getImageData(0, 0, w, h).data;
        var result = new Uint8Array(mask.length);
        for (var index = 0; index < result.length; index++) result[index] = painted[index * 4] > 127 ? 1 : 0;
        return result;
    };

    ShapeFactory._measureMask = function (mask, w, h) {
        var visited = new Uint8Array(mask.length), queue = new Int32Array(mask.length);
        var components = 0, smallComponents = 0, edgePixels = 0;
        for (var y = 0; y < h; y++) {
            for (var x = 0; x < w; x++) {
                var index = y * w + x;
                if (mask[index] && (x === 0 || x === w - 1 || y === 0 || y === h - 1 ||
                    !mask[index - 1] || !mask[index + 1] || !mask[index - w] || !mask[index + w])) edgePixels++;
                if (!mask[index] || visited[index]) continue;
                components++;
                var head = 0, tail = 0;
                queue[tail++] = index; visited[index] = 1;
                while (head < tail) {
                    var current = queue[head++], cx = current % w;
                    if (cx > 0 && mask[current - 1] && !visited[current - 1]) { visited[current - 1] = 1; queue[tail++] = current - 1; }
                    if (cx < w - 1 && mask[current + 1] && !visited[current + 1]) { visited[current + 1] = 1; queue[tail++] = current + 1; }
                    if (current >= w && mask[current - w] && !visited[current - w]) { visited[current - w] = 1; queue[tail++] = current - w; }
                    if (current < mask.length - w && mask[current + w] && !visited[current + w]) { visited[current + w] = 1; queue[tail++] = current + w; }
                }
                if (tail < Math.max(3, mask.length * 0.00008)) smallComponents++;
            }
        }
        return { components: components, smallComponents: smallComponents, edgeRatio: edgePixels / Math.max(1, w * h) };
    };

    ShapeFactory.fromImage = function (img, options) {
        return new Promise(function (resolve, reject) {
            setTimeout(function () {
                try {
                    if (typeof options === 'number') options = { threshold: options };
                    var result = ShapeFactory.createImageMask(img, options || {}, 640);
                    var canvas = result.canvas, w = result.width, h = result.height;
                    var thumbW = 80, thumbH = Math.max(1, Math.round(thumbW * h / w));
                    var thumbCanvas = document.createElement('canvas');
                    thumbCanvas.width = thumbW; thumbCanvas.height = thumbH;
                    var tctx = thumbCanvas.getContext('2d');
                    tctx.drawImage(canvas, 0, 0, thumbW, thumbH);
                    var thumbPath = ShapeFactory._traceMask(tctx.getImageData(0, 0, thumbW, thumbH));
                    var viewScale = 1000 / w;
                    resolve({
                        name: '自定义形状',
                        viewBox: { width: Math.round(w * viewScale), height: Math.round(h * viewScale) },
                        paths: [thumbPath || 'M0,0 L1,0 L1,1 L0,1 Z'],
                        thumbnailViewBox: { width: thumbW, height: thumbH },
                        maskCanvas: canvas, maskCanvasW: w, maskCanvasH: h, dynamic: true
                    });
                } catch (error) { reject(error); }
            }, 0);
        });
    };

    /* ------------------------------------------------------------------ *
     *  Boundary tracing — ONLY for small thumbnails (≤100px)
     * ------------------------------------------------------------------ */

    /**
     * Trace a binary mask (white=inside) into a simplified SVG path.
     * Uses Moore-neighbor boundary following + flood-fill visited marking.
     * Only suitable for small images (≤ ~100×100).
     */
    ShapeFactory._traceMask = function (imageData) {
        var w = imageData.width;
        var h = imageData.height;
        var data = imageData.data;

        function isInside(x, y) {
            if (x < 0 || x >= w || y < 0 || y >= h) return false;
            return data[(y * w + x) * 4] > 128;
        }

        var visited = new Uint8Array(w * h);
        var paths = [];

        for (var startY = 0; startY < h; startY++) {
            for (var startX = 0; startX < w; startX++) {
                var sIdx = startY * w + startX;
                if (visited[sIdx] || !isInside(startX, startY)) continue;

                // Only start from boundary pixels (have at least 1 outside neighbor)
                var isBoundary = false;
                for (var d = 0; d < 8; d++) {
                    var ddx = [1,1,0,-1,-1,-1,0,1][d];
                    var ddy = [0,1,1,1,0,-1,-1,-1][d];
                    if (!isInside(startX + ddx, startY + ddy)) {
                        isBoundary = true;
                        break;
                    }
                }
                if (!isBoundary) {
                    // Flood-fill mark all connected interior pixels as visited
                    ShapeFactory._floodFill(isInside, visited, w, h, startX, startY);
                    continue;
                }

                // Trace boundary
                var boundary = ShapeFactory._mooreTrace(isInside, visited, w, h, startX, startY);
                if (boundary.length < 4) continue;

                // Flood-fill the interior
                ShapeFactory._floodFill(isInside, visited, w, h, startX, startY);

                // Simplify
                var simplified = ShapeFactory._douglasPeucker(boundary, 1.5);
                if (simplified.length < 3) continue;

                var d2 = '';
                for (var k = 0; k < simplified.length; k++) {
                    d2 += (k === 0 ? 'M' : 'L') + simplified[k][0].toFixed(1) + ',' + simplified[k][1].toFixed(1);
                    if (k < simplified.length - 1) d2 += ' ';
                }
                d2 += ' Z';
                paths.push(d2);
            }
        }

        return paths.length > 0 ? paths.join(' ') : '';
    };

    /** Flood fill: mark all connected inside pixels as visited. */
    ShapeFactory._floodFill = function (isInside, visited, w, h, sx, sy) {
        var stack = [[sx, sy]];
        while (stack.length > 0) {
            var pt = stack.pop();
            var x = pt[0], y = pt[1];
            if (x < 0 || x >= w || y < 0 || y >= h) continue;
            var idx = y * w + x;
            if (visited[idx] || !isInside(x, y)) continue;
            visited[idx] = 1;
            stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
        }
    };

    /** Moore-neighborhood boundary tracing for one connected component. */
    ShapeFactory._mooreTrace = function (isInside, visited, w, h, sx, sy) {
        var dx = [1, 1, 0, -1, -1, -1, 0, 1];
        var dy = [0, 1, 1, 1, 0, -1, -1, -1];

        var boundary = [];
        var cx = sx, cy = sy;
        var prevDir = 7;
        var maxIter = w * h * 2;

        for (var iter = 0; iter < maxIter; iter++) {
            boundary.push([cx, cy]);
            visited[cy * w + cx] = 1;

            var found = false;
            for (var i = 0; i < 8; i++) {
                var dir = (prevDir + 6 + i) % 8;
                var nx = cx + dx[dir];
                var ny = cy + dy[dir];
                if (isInside(nx, ny)) {
                    cx = nx; cy = ny;
                    prevDir = dir;
                    found = true;
                    break;
                }
            }
            if (!found) break;
            if (cx === sx && cy === sy) break;
        }
        return boundary;
    };

    /** Douglas-Peucker line simplification. */
    ShapeFactory._douglasPeucker = function (points, epsilon) {
        if (points.length < 3) return points;

        function perpDist(p, a, b) {
            var dx = b[0] - a[0];
            var dy = b[1] - a[1];
            if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
            var t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
            t = Math.max(0, Math.min(1, t));
            var px = a[0] + t * dx;
            var py = a[1] + t * dy;
            return Math.hypot(p[0] - px, p[1] - py);
        }

        function simplify(pts, lo, hi, out) {
            if (lo >= hi) return;
            var maxDist = 0;
            var maxIdx = lo;
            for (var i = lo + 1; i < hi; i++) {
                var d = perpDist(pts[i], pts[lo], pts[hi]);
                if (d > maxDist) { maxDist = d; maxIdx = i; }
            }
            if (maxDist > epsilon) {
                simplify(pts, lo, maxIdx, out);
                out.push(pts[maxIdx]);
                simplify(pts, maxIdx, hi, out);
            }
        }

        var result = [points[0]];
        simplify(points, 0, points.length - 1, result);
        result.push(points[points.length - 1]);
        return result;
    };

export { Shapes, ShapeFactory };
