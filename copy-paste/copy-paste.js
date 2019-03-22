let THREE = require('../third-party/three.js/build/three.min.js');

const ID_AGENT_TRIGGER = 20;

const MAGIC_ITEM_FILTER = "FilterItemCategories";

const OPTIONS = [
    'severOutsideLinks',
    'severOutsideOffsets',
    'pinOutsideOffsets',
    'clearTargetArea'
];

function strToPoint(s)
{
    let xyz = s.split(",").map( x => parseInt(x) );
    return new THREE.Vector3(...xyz);
}

function strToPoints(s)
{
    return s.split(";").map( strToPoint );
}

function pointToStr(v)
{
    return [v.x,v.y,v.z].map(Math.round).join(",");
}

// HACK
THREE.Vector3.prototype.toString = function() { return pointToStr(this); };

function pointsToStr(vs)
{
    return vs.map(pointToStr).join(";");
}

function pointsToBox(pos, offset)
{
    let box = new THREE.Box3();
    return box.setFromPoints([pos,pos.clone().add(offset)]);
}

function move(pos, fromBox, toBox)
{
    return pos.clone().sub(fromBox.min).add(toBox.min);
}

function getProperty(props, key)
{
    for( prop of props ) {
        if( prop.key == key ) {
            return prop.value;
        }
    }

    return null;
}

function isMarkerBlock(block)
{
    return block.o && block.o.t == ID_AGENT_TRIGGER &&
        getProperty(block.o.p, "itemFilter") == MAGIC_ITEM_FILTER;
}


function findMarkerBlocks(blocks)
{
    let result = [];

    for( block of blocks ) {
        if( isMarkerBlock(block) ) {
            let pos    = strToPoint(block.pos);
            let offset = strToPoint(getProperty(block.o.p, "offset"));
            let toBoxes =
                strToPoints(getProperty(block.o.p, "linkedStructurePos"))
                .map( p => pointsToBox(p, offset) );

            result.push({ fromBox: pointsToBox(pos,offset),
                          toBoxes: toBoxes });
        }
    }

    return result;
}

function mapProps(props, fn)
{
    let newProps = [];
    for( let prop of props ) {
        let result = fn(prop.key, prop.value);
        if( result ) {
            newProps.push({key: prop.key, value: result});
        }
    }
    return newProps;
}

function moveOrSever(pos, fromBox, toBox, severOutsideLinks)
{
    if( severOutsideLinks && !fromBox.containsPoint(pos) ) {
        console.log(`Severing link: ${pos}`);
        return null;
    } else {
        let newPos = move(pos, fromBox, toBox);
        console.log(`Moving link: ${pos} -> ${newPos}`);
        return newPos;
    }
}

function copyBlocks(blocks, fromBox, toBoxes, options) {
    let newBlocks = [];

    console.log(`Copying ${fromBox.min}/${fromBox.max} to ` +
                toBoxes.map(toBox => `${toBox.min}/${toBox.max}`).join(", "));


    for( block of blocks ) {
        let pos = strToPoint(block.pos);
        if( fromBox.containsPoint(pos) ) {

            // don't copy marker block, but copy structure block at same pos
            if( isMarkerBlock(block) ) {
                if( !block.s ) {
                    continue;
                }
                block = Object.assign({}, block);
                delete block.o;
            }

            for( toBox of toBoxes ) {
                let newBlock = Object.assign({}, block);

                let newPos = move(pos, fromBox, toBox);

                newBlock.pos = pointToStr( newPos );

                let info = ( newBlock.o || newBlock.s || {} );
                if (info && info.p) {
                    info.p = mapProps(info.p, function(key,value) {
                        switch(key) {
                        case "linkedStructurePos":
                            return pointsToStr(
                                strToPoints(value)
                                    .map( p => moveOrSever(p, fromBox, toBox, options.severOutsideLinks ))
                                    .filter( x => x )
                            );
                        case "offset":
                            let offset = strToPoint(value);
                            let target = pos.clone().add(offset);
                            let newTarget = target;
                            if(!options.pinOutsideOffsets) {
                                newTarget = moveOrSever( target, fromBox, toBox, options.severOutsideOffsets );
                            }
                            return newTarget ? pointToStr(newTarget.sub(newPos)) : null;
                        default:
                            return value;
                        }
                    });
                }

                newBlocks.push( newBlock );
            }
        }
    }

    return newBlocks;
}

function processSave(save, options) {
    let markers = findMarkerBlocks(save.blocks);

    console.log(`Found ${markers.length} area(s) to copy.`);

    for( let {fromBox, toBoxes} of markers ) {
        if( options.clearTargetArea ) {
            for( let toBox of toBoxes ) {
                save.blocks = save.blocks.filter(
                    block => !toBox.containsPoint( strToPoint(block.pos) ) );
            }
        }
        let newBlocks = copyBlocks(save.blocks, fromBox, toBoxes, options);
        save.blocks = save.blocks.concat( newBlocks );
    }

    return save;
}


function magic() {

    let options = {};
    for (let option of OPTIONS) {
        options[option] = document.getElementById(option).checked;
    }

    let f = document.getElementById('f').files[0];
    let r = new FileReader();

    r.onload = function(e) {
        let save = JSON.parse(e.target.result);

        try {
            processSave(save, options);
        } catch (e) {
            console.log(e);
            return;
        }

        let el = document.createElement('a');
        el.setAttribute('href', URL.createObjectURL(new Blob( [JSON.stringify(save)], {type: 'text/plain'} )));
        el.setAttribute('download', f.name.replace(/\.sav$/, '-modified.sav'));
        el.innerText = 'download';
        document.body.appendChild(el);
    };

    r.readAsText(f);
}
