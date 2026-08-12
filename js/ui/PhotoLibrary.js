function createPhotoCard(photo) {
    var card = document.createElement('div');
    card.className = 'photo-card';
    card.draggable = true;
    card.title = '拖拽排序';
    card.setAttribute('data-photo-id', photo.id);
    var order = document.createElement('span');
    order.className = 'photo-order';
    var image = document.createElement('img');
    image.alt = photo.name || '';
    image.decoding = 'async';
    image.loading = 'lazy';
    var feature = document.createElement('button');
    feature.className = 'photo-feature';
    feature.type = 'button';
    feature.textContent = '★';
    feature.title = '重点照片优先进入大图格位';
    var remove = document.createElement('button');
    remove.className = 'photo-remove';
    remove.type = 'button';
    remove.textContent = '×';
    card.append(order, image, feature, remove);
    return card;
}

export function createPhotoLibrary(options) {
    var library = document.getElementById(options.libraryId || 'photo-library');
    var panel = document.getElementById(options.panelId || 'photo-library-panel');
    var dragIndex = -1;
    var pointerGesture = null;
    var longPressTimer = null;

    function clearDragStyles() {
        library.querySelectorAll('.photo-card').forEach(function (item) {
            item.classList.remove('dragging', 'drag-over');
        });
    }

    function render(photos) {
        panel.hidden = photos.length === 0;
        var existing = new Map();
        library.querySelectorAll('.photo-card[data-photo-id]').forEach(function (card) {
            existing.set(card.getAttribute('data-photo-id'), card);
        });
        var fragment = document.createDocumentFragment();
        photos.forEach(function (photo, index) {
            var card = existing.get(photo.id) || createPhotoCard(photo);
            existing.delete(photo.id);
            card.setAttribute('data-index', index);
            card.classList.remove('dragging', 'drag-over');
            card.querySelector('.photo-order').textContent = index + 1;
            var image = card.querySelector('img');
            if (image.src !== photo.src) image.src = photo.src;
            image.alt = photo.name || '';
            card.querySelector('.photo-remove').setAttribute('aria-label', '移除 ' + (photo.name || '照片'));
            var feature = card.querySelector('.photo-feature');
            feature.classList.toggle('active', photo.featured === true);
            feature.setAttribute('aria-pressed', photo.featured === true ? 'true' : 'false');
            feature.setAttribute('aria-label', (photo.featured ? '取消重点照片 ' : '设为重点照片 ') + (photo.name || ''));
            fragment.appendChild(card);
        });
        existing.forEach(function (card) { card.remove(); });
        library.appendChild(fragment);
    }

    function bind() {
        library.addEventListener('dragstart', function (event) {
            var card = event.target.closest('.photo-card');
            if (!card) return;
            dragIndex = Number(card.getAttribute('data-index'));
            card.classList.add('dragging');
            event.dataTransfer.effectAllowed = 'move';
        });
        library.addEventListener('dragover', function (event) {
            var card = event.target.closest('.photo-card');
            if (!card) return;
            event.preventDefault();
            library.querySelectorAll('.photo-card').forEach(function (item) { item.classList.remove('drag-over'); });
            card.classList.add('drag-over');
        });
        library.addEventListener('drop', function (event) {
            var card = event.target.closest('.photo-card');
            if (!card || dragIndex < 0) return;
            event.preventDefault();
            var targetIndex = Number(card.getAttribute('data-index'));
            if (targetIndex !== dragIndex) options.onReorder(dragIndex, targetIndex);
            dragIndex = -1;
        });
        library.addEventListener('dragend', function () {
            dragIndex = -1;
            clearDragStyles();
        });

        // HTML drag-and-drop is inconsistent in Android/iOS WebViews. A short
        // long-press activates the same reorder flow while ordinary swipes keep
        // scrolling the thumbnail list.
        library.addEventListener('pointerdown', function (event) {
            if (event.pointerType === 'mouse' || event.target.closest('button')) return;
            var card = event.target.closest('.photo-card');
            if (!card) return;
            clearTimeout(longPressTimer);
            pointerGesture = {
                pointerId: event.pointerId,
                sourceIndex: Number(card.getAttribute('data-index')),
                targetIndex: Number(card.getAttribute('data-index')),
                startX: event.clientX,
                startY: event.clientY,
                card: card,
                active: false
            };
            longPressTimer = setTimeout(function () {
                if (!pointerGesture || pointerGesture.pointerId !== event.pointerId) return;
                pointerGesture.active = true;
                dragIndex = pointerGesture.sourceIndex;
                pointerGesture.card.classList.add('dragging');
                try { library.setPointerCapture(event.pointerId); } catch (ignore) {}
            }, 240);
        });
        library.addEventListener('pointermove', function (event) {
            if (!pointerGesture || pointerGesture.pointerId !== event.pointerId) return;
            if (!pointerGesture.active) {
                if (Math.hypot(event.clientX - pointerGesture.startX, event.clientY - pointerGesture.startY) > 9) {
                    clearTimeout(longPressTimer);
                    pointerGesture = null;
                }
                return;
            }
            event.preventDefault();
            var pointed = document.elementFromPoint(event.clientX, event.clientY);
            var target = pointed && pointed.closest('.photo-card');
            if (!target || !library.contains(target)) return;
            clearDragStyles();
            pointerGesture.card.classList.add('dragging');
            target.classList.add('drag-over');
            pointerGesture.targetIndex = Number(target.getAttribute('data-index'));
        });
        function finishPointer(event) {
            if (!pointerGesture || pointerGesture.pointerId !== event.pointerId) return;
            clearTimeout(longPressTimer);
            var sourceIndex = pointerGesture.sourceIndex;
            var targetIndex = pointerGesture.targetIndex;
            var active = pointerGesture.active;
            pointerGesture = null;
            dragIndex = -1;
            clearDragStyles();
            try { library.releasePointerCapture(event.pointerId); } catch (ignore) {}
            if (active && targetIndex !== sourceIndex) options.onReorder(sourceIndex, targetIndex);
        }
        library.addEventListener('pointerup', finishPointer);
        library.addEventListener('pointercancel', finishPointer);
        library.addEventListener('click', function (event) {
            var feature = event.target.closest('.photo-feature');
            var remove = event.target.closest('.photo-remove');
            if (!feature && !remove) return;
            var card = (feature || remove).closest('.photo-card');
            var index = Number(card.getAttribute('data-index'));
            if (feature) options.onFeature(index);
            else options.onRemove(index);
        });
    }

    return { bind: bind, render: render };
}
